import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const source = path.join('app-server', 'src', 'models.rs');
const cachedCall = '.list_models(RefreshStrategy::OnlineIfUncached, http_client_factory)';
const liveCall = '.list_models(RefreshStrategy::Online, http_client_factory)';

export async function applyHexaModelCatalogRefresh(engineRoot) {
  const sourcePath = path.join(engineRoot, source);
  let text = await readFile(sourcePath, 'utf8');
  if (text.includes(liveCall)) return 0;
  if (!text.includes(cachedCall)) {
    throw new Error(`Cannot apply Hexa live model-catalog patch: ${source} changed around supported_models()`);
  }
  text = text.replace(cachedCall, liveCall);
  await writeFile(sourcePath, text);
  return 1;
}
