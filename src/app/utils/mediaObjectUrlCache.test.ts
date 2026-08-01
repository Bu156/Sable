// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubObjectUrls } from '../../test/objectUrlStub';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
}));

import { clearMediaObjectUrls, ensureMediaObjectUrl, getMediaObjectUrl } from './mediaObjectUrlCache';

beforeEach(() => {
  stubObjectUrls();
  clearMediaObjectUrls();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mediaObjectUrlCache', () => {
  it('holds picker loads to the shared media fetch budget', async () => {
    let inFlight = 0;
    let peak = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          resolve(new Response('image-bytes', { status: 200 }));
        }, 5);
      });
    });

    const resolved = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        ensureMediaObjectUrl(`https://example.org/media/${index}`)
      )
    );

    expect(resolved).toHaveLength(10);
    expect(peak).toBe(3);
  });

  it('revokes and forgets every entry on clear', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image-bytes', { status: 200 }));

    await ensureMediaObjectUrl('https://example.org/media/a');
    expect(getMediaObjectUrl('https://example.org/media/a')).toBe('blob:mock-1');

    clearMediaObjectUrls();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    expect(getMediaObjectUrl('https://example.org/media/a')).toBeUndefined();
  });
});
