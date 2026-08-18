import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({
  useRenderableMediaUrl: vi.fn<(url: string | undefined) => string | undefined>(),
}));

vi.mock('$hooks/useRenderableMediaUrl', () => media);

const RAW_SRC = 'https://example.org/_matrix/client/v1/media/thumbnail/example.org/avatar';

describe('RoomAvatar', () => {
  beforeEach(() => {
    vi.resetModules();
    media.useRenderableMediaUrl.mockReset();
  });

  it('shows the image once the resolved url arrives after a failed raw request', async () => {
    media.useRenderableMediaUrl.mockReturnValue(undefined);
    const { RoomAvatar } = await import('./RoomAvatar');

    const { rerender } = render(
      <RoomAvatar roomId="!room:example.org" src={RAW_SRC} renderFallback={() => 'RM'} />
    );

    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    media.useRenderableMediaUrl.mockReturnValue('blob:resolved-avatar');
    rerender(<RoomAvatar roomId="!room:example.org" src={RAW_SRC} renderFallback={() => 'RM'} />);

    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:resolved-avatar');
  });
});
