import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCreateObjectURL } from './useObjectURL';

describe('useCreateObjectURL', () => {
  let created: number;

  beforeEach(() => {
    vi.restoreAllMocks();
    created = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      created += 1;
      return `blob:url-${created}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  it('revokes the owned url on unmount', () => {
    const { result, unmount } = renderHook(() => useCreateObjectURL());
    result.current(new Blob(['a']));

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:url-1');
  });

  it('revokes the previous url when a new one replaces it', () => {
    const { result } = renderHook(() => useCreateObjectURL());
    result.current(new Blob(['a']));
    result.current(new Blob(['b']));

    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:url-1');
  });

  it('revokes immediately when the blob resolves after unmount', () => {
    const { result, unmount } = renderHook(() => useCreateObjectURL());
    unmount();

    result.current(new Blob(['late']));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:url-1');
  });

  it('keeps a stable identity so it can sit in effect dependencies', () => {
    const { result, rerender } = renderHook(() => useCreateObjectURL());
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
  });
});
