import { fetch } from '$utils/fetch';
import { withMediaFetchSlot } from './mediaConcurrency';

// Tauri webviews don't HTTP-cache responses from the sable-media scheme handler, so
// every remount round-trips into the native layer. Session object URLs avoid that.
const MAX_ENTRIES = 256;

type CacheEntry = string | Promise<string>;

const objectUrls = new Map<string, CacheEntry>();

function remember(url: string, objectUrl: string): void {
  objectUrls.delete(url);
  objectUrls.set(url, objectUrl);
  while (objectUrls.size > MAX_ENTRIES) {
    const oldestKey = objectUrls.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = objectUrls.get(oldestKey);
    objectUrls.delete(oldestKey);
    if (typeof oldest === 'string') URL.revokeObjectURL(oldest);
  }
}

export function getMediaObjectUrl(url: string): string | undefined {
  const entry = objectUrls.get(url);
  if (typeof entry !== 'string') return undefined;
  remember(url, entry);
  return entry;
}

export function ensureMediaObjectUrl(url: string): Promise<string> {
  const existing = objectUrls.get(url);
  if (existing !== undefined) return Promise.resolve(existing);

  const request = withMediaFetchSlot(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`media fetch failed: ${response.status}`);
    return response.blob();
  })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      remember(url, objectUrl);
      return objectUrl;
    })
    .catch((err: unknown) => {
      if (objectUrls.get(url) === request) objectUrls.delete(url);
      throw err;
    });

  objectUrls.set(url, request);
  return request;
}

export function clearMediaObjectUrls(): void {
  objectUrls.forEach((entry) => {
    if (typeof entry === 'string') URL.revokeObjectURL(entry);
  });
  objectUrls.clear();
}
