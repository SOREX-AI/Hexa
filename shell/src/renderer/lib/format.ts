export function relativeTime(value?: number | string | null): string {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value > 1e12 ? value : value * 1000) : new Date(value);
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function shortenPath(input?: string | null, max = 54): string {
  if (!input) return 'No folder selected';
  const value = typeof input === 'string' ? input : String(input);
  if (value.length <= max) return value;
  const chunks = value.replaceAll('\\', '/').split('/');
  if (chunks.length < 3) return `…${value.slice(-(max - 1))}`;
  return `${chunks[0]}/…/${chunks.slice(-2).join('/')}`;
}

export function titleFromThread(thread: any): string {
  for (const candidate of [thread?.name, thread?.title, thread?.preview, thread?.firstUserMessage]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate.text ?? candidate.content?.find?.((part: any) => part?.type === 'text')?.text;
      if (typeof nested === 'string' && nested.trim()) return nested;
    }
  }
  return 'Untitled chat';
}

export function commandLabel(command: unknown): string {
  if (Array.isArray(command)) return command.join(' ');
  if (typeof command === 'string') return command;
  return 'Command';
}
