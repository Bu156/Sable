import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({
  useRenderableMediaUrl: vi.fn<(url: string | undefined) => string | undefined>(),
}));

vi.mock('$hooks/useRenderableMediaUrl', () => media);

const RAW_SRC = 'https://example.org/_matrix/client/v1/media/thumbnail/example.org/avatar';

describe('UserAvatar', () => {
  beforeEach(() => {
    vi.resetModules();
    media.useRenderableMediaUrl.mockReset();
  });

  it('shows the image once the resolved url arrives after a failed raw request', async () => {
    media.useRenderableMediaUrl.mockReturnValue(undefined);
    const { UserAvatar } = await import('./UserAvatar');

    const { rerender } = render(
      <UserAvatar userId="@user:example.org" src={RAW_SRC} renderFallback={() => 'US'} />
    );

    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    media.useRenderableMediaUrl.mockReturnValue('blob:resolved-avatar');
    rerender(<UserAvatar userId="@user:example.org" src={RAW_SRC} renderFallback={() => 'US'} />);

    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:resolved-avatar');
  });
});
