// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { stubObjectUrls } from '../../../test/objectUrlStub';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));

import { clearMediaObjectUrls } from '$utils/mediaObjectUrlCache';
import { Image } from './Image';

const wrapMediaUrl = (target: string) =>
  `http://sable-media.localhost/${encodeURIComponent(target)}?__sable_media_cache=3`;

const THUMBNAIL_URL = wrapMediaUrl('https://example.org/_matrix/media/v3/thumbnail/a/b');
const DOWNLOAD_URL = wrapMediaUrl('https://example.org/_matrix/media/v3/download/a/b');
const LOOKALIKE_URL = wrapMediaUrl('https://example.org/_matrix/media/v3/download/a/thumbnail.png');

beforeEach(() => {
  stubObjectUrls();
  clearMediaObjectUrls();
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response('image-bytes', { status: 200 }))
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Image on Tauri', () => {
  it('serves thumbnails from the session blob cache, fetching once across remounts', async () => {
    const first = render(<Image src={THUMBNAIL_URL} alt="thumb" />);
    await waitFor(() => expect(screen.getByAltText('thumb')).toHaveAttribute('src', 'blob:mock-1'));
    first.unmount();

    render(<Image src={THUMBNAIL_URL} alt="thumb-again" />);
    expect(screen.getByAltText('thumb-again')).toHaveAttribute('src', 'blob:mock-1');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps full-size downloads on the native scheme path', () => {
    render(<Image src={DOWNLOAD_URL} alt="full" />);

    expect(screen.getByAltText('full')).toHaveAttribute('src', DOWNLOAD_URL);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not treat a download named "thumbnail" as a thumbnail', () => {
    render(<Image src={LOOKALIKE_URL} alt="lookalike" />);

    expect(screen.getByAltText('lookalike')).toHaveAttribute('src', LOOKALIKE_URL);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('session-caches small picker downloads and skips files over the size gate', async () => {
    render(<Image src={DOWNLOAD_URL} alt="emote" sessionCache info={{ size: 20_000 }} />);
    await waitFor(() => expect(screen.getByAltText('emote')).toHaveAttribute('src', 'blob:mock-1'));

    render(<Image src={DOWNLOAD_URL} alt="big" sessionCache info={{ size: 5_000_000 }} />);
    expect(screen.getByAltText('big')).toHaveAttribute('src', DOWNLOAD_URL);
  });
});
