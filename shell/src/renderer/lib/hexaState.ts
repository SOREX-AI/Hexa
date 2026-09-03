import type { ServerEvent } from '../../shared/types';

type Item = Record<string, any>;
type TurnState = {
  id: string;
  status: string;
  items: Item[];
  itemsView?: 'notLoaded' | 'summary' | 'full' | string;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  error?: any;
  diff?: string;
  plan?: any[];
};
export type ThreadView = {
  id: string;
  name?: string;
  title?: string;
  preview?: string;
  cwd?: string;
  model?: string;
  modelProvider?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: any;
  turns?: TurnState[];
  archived?: boolean;
  tokenUsage?: any;
};

export function normalizeThread(raw: any): ThreadView {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawTurns = Array.isArray(source.turns) ? source.turns : [];
  return {
    ...source,
    id: String(source.id ?? ''),
    name: asOptionalString(source.name),
    title: firstText(source.title, source.preview, source.firstUserMessage),
    cwd: asOptionalString(source.cwd ?? source.session?.cwd),
    model: source.model ?? source.settings?.model ?? undefined,
    modelProvider: source.modelProvider ?? source.model_provider ?? source.settings?.modelProvider ?? undefined,
    turns: rawTurns.map(normalizeTurn),
  };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
    if (value && typeof value === 'object') {
      const record = value as Record<string, any>;
      if (typeof record.text === 'string' && record.text.length > 0) return record.text;
      if (Array.isArray(record.content)) {
        const text = record.content.find((part: any) => part?.type === 'text' && typeof part.text === 'string')?.text;
        if (text) return text;
      }
    }
  }
  return undefined;
}

export function normalizeTurn(raw: any): TurnState {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    ...source,
    id: String(source.id ?? ''),
    status: source.status ?? 'completed',
    items: Array.isArray(source.items)
      ? source.items.filter((item: unknown): item is Item => Boolean(item) && typeof item === 'object')
      : [],
  };
}

export function mergeThread(base: ThreadView, incoming: any): ThreadView {
  const left = normalizeThread(base);
  const right = normalizeThread(incoming);
  const merged: ThreadView = { ...left, ...right };

  const turns = new Map<string, TurnState>();
  for (const turn of left.turns ?? []) turns.set(turn.id, normalizeTurn(turn));
  for (const raw of right.turns ?? []) {
    const next = normalizeTurn(raw);
    const prior = turns.get(next.id);
    turns.set(next.id, prior ? mergeTurn(prior, next) : next);
  }
  merged.turns = [...turns.values()];
  return merged;
}

function mergeTurn(base: TurnState, incoming: TurnState): TurnState {
  const merged: TurnState = { ...base, ...incoming, items: [] };
  const baseById = new Map((base.items ?? []).map((item) => [item.id, item]));

  // A full history page/resume is canonical rollout order. Use its ordering
  // instead of preserving a transient live order from summary notifications.
  if (incoming.itemsView === 'full') {
    const incomingIds = new Set((incoming.items ?? []).map((item) => item.id));
    merged.items = (incoming.items ?? []).map((item) => ({ ...baseById.get(item.id), ...item }));
    // A few lifecycle items (notably late sub-agent completion activity) can
    // arrive after the turn boundary. Keep any live-only items until the next
    // canonical history read catches up instead of making them blink away.
    for (const item of base.items ?? []) {
      // Guardian review notifications are real engine activity but are not
      // persisted as canonical turn items by the current app-server protocol.
      // Keep them when a full history refresh arrives so the completed sandbox
      // check remains visible in the tool history.
      if (!incomingIds.has(item.id) && (
        String(item.id ?? '').startsWith('local-')
        || item.type === 'guardianPermissionReview'
        || isTransientToolItem(item)
      )) {
        const preserved = { ...item };
        const afterIndex = preserved.afterItemId == null
          ? -1
          : merged.items.findIndex((entry) => entry.id === preserved.afterItemId);
        if (afterIndex >= 0) merged.items.splice(afterIndex + 1, 0, preserved);
        else merged.items.push(preserved);
      }
    }
    return merged;
  }

  const items = new Map<string, Item>();
  for (const item of base.items ?? []) items.set(item.id, { ...item });
  for (const item of incoming.items ?? []) {
    const prior = items.get(item.id);
    items.set(item.id, prior ? { ...prior, ...item } : { ...item });
  }
  merged.items = [...items.values()];
  return merged;
}

function getTurn(thread: ThreadView, turnId: string): TurnState {
  thread.turns ??= [];
  let turn = thread.turns.find((entry) => entry.id === turnId);
  if (!turn) {
    turn = { id: turnId, status: 'inProgress', items: [] };
    thread.turns.push(turn);
  }
  return turn;
}

function activeTurnId(thread: ThreadView): string {
  return [...(thread.turns ?? [])].reverse().find((turn) => turn.status === 'inProgress')?.id ?? 'active';
}

function rawResponseItemType(item: any): string {
  return String(item?.type ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function rawCustomToolItem(item: any): Item | null {
  if (rawResponseItemType(item) !== 'custom_tool_call') return null;
  const id = String(item?.callId ?? item?.call_id ?? item?.id ?? '');
  if (!id) return null;
  return {
    id,
    type: 'dynamicToolCall',
    namespace: item?.namespace ?? null,
    tool: item?.name ?? item?.tool ?? 'tool',
    arguments: item?.input ?? item?.arguments ?? '',
    status: 'inProgress',
    _shellRawCustomTool: true,
  };
}

function skillSlugFromToolInput(value: unknown): string | null {
  const input = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return input.match(/(?:^|[\\/])skills[\\/]([^\\/'"\\]+)[\\/]SKILL\.md/i)?.[1]?.toLowerCase() ?? null;
}

export function applyServerEvent(thread: ThreadView, event: ServerEvent): ThreadView {
  const next: ThreadView = structuredClone(thread);
  const p: any = event.params ?? {};
  const eventThreadId = p.threadId ?? p.thread?.id;
  if (eventThreadId && eventThreadId !== next.id) return next;

  if (event.method === 'thread/tokenUsage/updated') {
    next.tokenUsage = p.tokenUsage ?? p.usage ?? p;
    return next;
  }
  if (event.method === 'thread/name/updated') {
    next.name = p.name;
    return next;
  }
  if (event.method === 'thread/status/changed') {
    next.status = p.status;
    return next;
  }
  if (event.method === 'turn/started') {
    const t = normalizeTurn(p.turn ?? p);
    next.turns ??= [];
    let index = next.turns.findIndex((entry) => entry.id === t.id);
    if (index < 0) index = next.turns.findLastIndex((entry) => entry.id.startsWith('local-') && entry.status === 'inProgress');
    if (index >= 0) next.turns[index] = { ...next.turns[index], ...t, items: t.items.length ? t.items : next.turns[index].items };
    else next.turns.push(t);
    return next;
  }
  if (event.method === 'turn/completed') {
    const t = normalizeTurn(p.turn ?? p);
    const target = getTurn(next, t.id);
    // turn/completed intentionally carries only the final agent message as a
    // summary fallback. Never replace the live canonical item stream with it:
    // doing so puts the assistant message before the user/tool items and makes
    // completed command clusters disappear.
    const existingItems = target.items ?? [];
    const fallbackItems = t.items ?? [];
    Object.assign(target, { ...t, items: existingItems });
    for (const item of fallbackItems) {
      const index = target.items.findIndex((entry) => entry.id === item.id);
      if (index >= 0) target.items[index] = { ...target.items[index], ...item };
      else target.items.push(item);
    }
    return next;
  }
  if (event.method === 'turn/diff/updated') {
    getTurn(next, p.turnId).diff = p.diff;
    return next;
  }
  if (event.method === 'turn/plan/updated') {
    getTurn(next, p.turnId).plan = p.plan;
    return next;
  }
  if (isGuardianPermissionReviewEvent(event.method)) {
    const item = guardianPermissionReviewItem(event, isGuardianPermissionReviewComplete(event.method) ? 'completed' : 'inProgress');
    const turn = getTurn(next, p.turnId ?? p.turn_id ?? activeTurnId(next));
    const index = turn.items.findIndex((entry) => entry.id === item.id);
    if (index >= 0) turn.items[index] = { ...turn.items[index], ...item };
    else turn.items.push(item);
    return next;
  }
  if (event.method === 'rawResponseItem/completed') {
    const rawItem = p.item ?? {};
    const turn = getTurn(next, p.turnId ?? p.turn_id ?? activeTurnId(next));
    const customTool = rawCustomToolItem(rawItem);
    if (customTool) {
      const rawCallId = customTool.id;
      const skillSlug = skillSlugFromToolInput(customTool.arguments);
      const index = turn.items.findIndex((entry) => entry.id === rawCallId || (skillSlug && entry._shellDeclaredSkill === skillSlug));
      if (index >= 0) turn.items[index] = { ...turn.items[index], ...customTool, id: turn.items[index].id, _shellRawCallId: rawCallId };
      else turn.items.push(customTool);
      return next;
    }
    if (rawResponseItemType(rawItem) === 'custom_tool_call_output') {
      const callId = String(rawItem.callId ?? rawItem.call_id ?? '');
      const index = turn.items.findIndex((entry) => (entry.id === callId || entry._shellRawCallId === callId) && entry._shellRawCustomTool);
      if (index >= 0) {
        const failed = Boolean(rawItem.error) || rawItem.success === false;
        turn.items[index] = {
          ...turn.items[index],
          status: failed ? 'failed' : 'completed',
          success: !failed,
          contentItems: rawItem.output ?? turn.items[index].contentItems,
          error: rawItem.error ?? turn.items[index].error,
        };
      }
    }
    return next;
  }
  if (
    event.method === 'item/started' ||
    event.method === 'item/completed' ||
    event.method === 'item/updated'
  ) {
    const eventStatus = event.method === 'item/started'
      ? 'inProgress'
      : event.method === 'item/completed'
        ? 'completed'
        : undefined;
    const item = { ...(p.item ?? p) };
    item.status ??= eventStatus;
    const turn = getTurn(next, p.turnId ?? p.turn_id ?? item.turnId ?? item.turn_id ?? activeTurnId(next));
    if (item.type === 'userMessage') {
      turn.items = turn.items.filter((entry) => !(entry.type === 'userMessage' && String(entry.id ?? '').startsWith('local-')));
    }
    const itemSkillSlug = item.type === 'dynamicToolCall' ? skillSlugFromToolInput(item.arguments) : null;
    const index = turn.items.findIndex((entry) => entry.id === item.id
      || entry._shellRawCallId === item.id
      || (itemSkillSlug && entry._shellDeclaredSkill === itemSkillSlug));
    if (index >= 0) turn.items[index] = { ...turn.items[index], ...item };
    else turn.items.push(item);
    return next;
  }

  if (event.method === 'item/fileChange/patchUpdated') {
    const turn = getTurn(next, p.turnId ?? p.turn_id ?? activeTurnId(next));
    let item = turn.items.find((entry) => entry.id === p.itemId);
    if (!item) {
      item = { id: p.itemId, type: 'fileChange', status: 'inProgress', changes: [] };
      turn.items.push(item);
    }
    if (p.diff) item.diff = p.diff;
    if (p.patch) item.patch = p.patch;
    if (Array.isArray(p.changes)) item.changes = p.changes;
    return next;
  }

  const deltaMethods: Record<string, string> = {
    'item/agentMessage/delta': 'text',
    'item/plan/delta': 'text',
    'item/reasoning/summaryTextDelta': 'summaryDelta',
    'item/reasoning/textDelta': 'reasoningDelta',
    'item/commandExecution/outputDelta': 'outputDelta',
    'item/commandExecution/terminalInteraction': 'outputDelta',
    'item/fileChange/outputDelta': 'outputDelta',
    'item/mcpToolCall/progress': 'progressText',
    'item/dynamicToolCall/progress': 'progressText',
    'item/collabAgentToolCall/progress': 'progressText',
    'item/collabToolCall/progress': 'progressText',
  };
  const field = deltaMethods[event.method];
  if (field) {
    const turn = getTurn(next, p.turnId ?? p.turn_id ?? activeTurnId(next));
    let item = turn.items.find((entry) => entry.id === p.itemId);
    if (!item) {
      item = { id: p.itemId, type: inferTypeFromMethod(event.method), status: 'inProgress' };
      turn.items.push(item);
    }
    const delta = p.delta ?? p.text ?? p.message ?? '';
    if (field === 'summaryDelta') {
      item.summary ??= [''];
      const index = p.summaryIndex ?? 0;
      item.summary[index] = `${item.summary[index] ?? ''}${delta}`;
    } else if (field === 'reasoningDelta') {
      item.content ??= [''];
      const index = p.contentIndex ?? 0;
      item.content[index] = `${item.content[index] ?? ''}${delta}`;
    } else {
      item[field] = `${item[field] ?? ''}${delta}`;
    }
  }
  return next;
}

function inferTypeFromMethod(method: string): string {
  if (method.includes('agentMessage')) return 'agentMessage';
  if (method.includes('reasoning')) return 'reasoning';
  if (method.includes('commandExecution')) return 'commandExecution';
  if (method.includes('fileChange')) return 'fileChange';
  if (method.includes('mcpToolCall')) return 'mcpToolCall';
  if (method.includes('dynamicToolCall')) return 'dynamicToolCall';
  if (method.includes('collabAgentToolCall')) return 'collabAgentToolCall';
  return 'activity';
}

function isGuardianPermissionReviewEvent(method: string): boolean {
  const normalized = method.toLowerCase();
  return normalized.includes('autoapprovalreview') || normalized.includes('guardianapprovalreview');
}

function isGuardianPermissionReviewComplete(method: string): boolean {
  return /completed|failed|denied|aborted/i.test(method);
}

function guardianPermissionReviewItem(event: ServerEvent, status: 'inProgress' | 'completed'): Item {
  const params: any = event.params ?? {};
  const review = params.review ?? {};
  return {
    id: String(params.reviewId ?? params.review_id ?? params.id ?? `guardian-review-${params.targetItemId ?? params.target_item_id ?? 'active'}`),
    type: 'guardianPermissionReview',
    status,
    toolName: 'Sandbox permission check',
    targetItemId: params.targetItemId ?? params.target_item_id,
    progressText: review.rationale ?? params.rationale ?? '',
    source: 'hexa-engine',
  };
}

function isTransientToolItem(item: Item): boolean {
  const type = String(item?.type ?? '');
  if ([
    'commandExecution', 'localShellCall', 'fileChange', 'mcpToolCall',
    'dynamicToolCall', 'webSearch', 'imageGeneration', 'collabToolCall',
    'collabAgentToolCall', 'subAgentActivity', 'sleep', 'imageView',
    'contextCompaction', 'functionCallOutput', 'hookPrompt',
    'enteredReviewMode', 'exitedReviewMode',
  ].includes(type)) return true;

  // The engine adds new external/tool lifecycle item kinds over time. If the
  // live stream identified an item as execution activity, keep it through a
  // canonical history refresh even when that history page does not know how to
  // persist the item yet. This prevents connector/plugin/browser activity from
  // vanishing as soon as the next assistant dialog arrives.
  return Boolean(
    type &&
    typeof item?.status === 'string' &&
    !['userMessage', 'agentMessage', 'reasoning', 'plan'].includes(type),
  );
}
