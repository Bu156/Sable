import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriApi = vi.hoisted(() => ({
  isTauri: vi.fn<() => boolean>(),
  convertFileSrc: vi.fn<(url: string, protocol: string) => string>(
    (url: string, protocol: string) => `${protocol}://${url}`
  ),
}));

vi.mock('@tauri-apps/api/core', () => tauriApi);

const { rewriteAuthenticatedMediaUrl } = await import('./matrix');

describe('rewriteAuthenticatedMediaUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for null input', () => {
    tauriApi.isTauri.mockReturnValue(true);
    expect(rewriteAuthenticatedMediaUrl(null)).toBeNull();
  });

  it('passes through non-Tauri without rewriting', () => {
    tauriApi.isTauri.mockReturnValue(false);
    const url = 'https://matrix.example.org/_matrix/client/v1/media/download/example.org/abc';
    expect(rewriteAuthenticatedMediaUrl(url)).toBe(url);
    expect(tauriApi.convertFileSrc).not.toHaveBeenCalled();
  });

  it('passes through plain https URLs that are not authenticated media', () => {
    tauriApi.isTauri.mockReturnValue(true);
    const url = 'https://example.org/avatar.png';
    expect(rewriteAuthenticatedMediaUrl(url)).toBe(url);
    expect(tauriApi.convertFileSrc).not.toHaveBeenCalled();
  });

  it('rewrites authenticated-media download URLs under Tauri', () => {
    tauriApi.isTauri.mockReturnValue(true);
    const url = 'https://matrix.example.org/_matrix/client/v1/media/download/example.org/abc123';
    expect(rewriteAuthenticatedMediaUrl(url)).toBe(`sable-media://${url}`);
    expect(tauriApi.convertFileSrc).toHaveBeenCalledWith(url, 'sable-media');
  });

  it('rewrites authenticated-media thumbnail URLs under Tauri', () => {
    tauriApi.isTauri.mockReturnValue(true);
    const url =
      'https://matrix.example.org/_matrix/client/v1/media/thumbnail/example.org/abc123?width=96&height=96&method=crop';
    expect(rewriteAuthenticatedMediaUrl(url)).toBe(`sable-media://${url}`);
  });

  it('passes through already-rewritten sable-media:// URLs', () => {
    tauriApi.isTauri.mockReturnValue(true);
    const url =
      'sable-media://https://matrix.example.org/_matrix/client/v1/media/download/example.org/abc123';
    expect(rewriteAuthenticatedMediaUrl(url)).toBe(url);
    expect(tauriApi.convertFileSrc).not.toHaveBeenCalled();
  });
});
