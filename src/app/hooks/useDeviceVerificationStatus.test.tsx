import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CryptoEvent, type CryptoApi } from '$types/matrix-sdk';

import {
  useDeviceVerificationStatus,
  useUnverifiedDeviceCount,
  VerificationStatus,
} from './useDeviceVerificationStatus';

const { mockMx } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  const mx = {
    on(event: string, cb: (...args: never[]) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
      return mx;
    },
    removeListener(event: string, cb: (...args: never[]) => void) {
      listeners.get(event)?.delete(cb);
      return mx;
    },
    emit(event: string, ...args: never[]) {
      listeners.get(event)?.forEach((cb) => cb(...args));
    },
  };
  return { mockMx: mx };
});

vi.mock('$hooks/useMatrixClient', () => ({
  useMatrixClient: () => mockMx,
}));

const USER_ID = '@me:example.org';
const DEVICE_ID = 'DEVICEONE';

const getDeviceVerificationStatus =
  vi.fn<(userId: string, deviceId: string) => Promise<{ crossSigningVerified: boolean } | null>>();
const crypto = { getDeviceVerificationStatus } as unknown as CryptoApi;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useDeviceVerificationStatus', () => {
  beforeEach(() => {
    getDeviceVerificationStatus.mockReset();
    getDeviceVerificationStatus.mockResolvedValue({ crossSigningVerified: true });
  });

  it('reports the cross-signing verification status', async () => {
    const { result } = renderHook(() => useDeviceVerificationStatus(crypto, USER_ID, DEVICE_ID), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBe(VerificationStatus.Unknown);
    await waitFor(() => expect(result.current).toBe(VerificationStatus.Verified));
  });

  it('reports Unsupported when the device has no verification status', async () => {
    getDeviceVerificationStatus.mockResolvedValue(null);

    const { result } = renderHook(() => useDeviceVerificationStatus(crypto, USER_ID, DEVICE_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current).toBe(VerificationStatus.Unsupported));
  });

  it('stays Unknown without a device id and never verifies', async () => {
    const { result } = renderHook(() => useDeviceVerificationStatus(crypto, USER_ID, undefined), {
      wrapper: createWrapper(),
    });

    await act(async () => {});

    expect(result.current).toBe(VerificationStatus.Unknown);
    expect(getDeviceVerificationStatus).not.toHaveBeenCalled();
  });

  it('stays Unknown without a crypto api and never verifies', async () => {
    const { result } = renderHook(
      () => useDeviceVerificationStatus(undefined, USER_ID, DEVICE_ID),
      { wrapper: createWrapper() }
    );

    await act(async () => {});

    expect(result.current).toBe(VerificationStatus.Unknown);
    expect(getDeviceVerificationStatus).not.toHaveBeenCalled();
  });

  it('verifies a device once when several consumers observe it', async () => {
    const { result } = renderHook(
      () =>
        [
          useDeviceVerificationStatus(crypto, USER_ID, DEVICE_ID),
          useDeviceVerificationStatus(crypto, USER_ID, DEVICE_ID),
          useUnverifiedDeviceCount(crypto, USER_ID, [DEVICE_ID]),
        ] as const,
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current[0]).toBe(VerificationStatus.Verified));
    await waitFor(() => expect(result.current[2]).toBe(0));

    expect(getDeviceVerificationStatus).toHaveBeenCalledTimes(1);
  });

  it('does not re-verify while no crypto event arrives', async () => {
    const { result, rerender } = renderHook(
      () => useDeviceVerificationStatus(crypto, USER_ID, DEVICE_ID),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current).toBe(VerificationStatus.Verified));
    rerender();
    rerender();

    expect(getDeviceVerificationStatus).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['DevicesUpdated for the user', CryptoEvent.DevicesUpdated, [[USER_ID], false]],
    ['KeysChanged', CryptoEvent.KeysChanged, [{}]],
    ['UserTrustStatusChanged for the user', CryptoEvent.UserTrustStatusChanged, [USER_ID, {}]],
  ])('re-verifies on %s', async (_label, event, args) => {
    const { result } = renderHook(() => useDeviceVerificationStatus(crypto, USER_ID, DEVICE_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current).toBe(VerificationStatus.Verified));
    expect(getDeviceVerificationStatus).toHaveBeenCalledTimes(1);

    getDeviceVerificationStatus.mockResolvedValue({ crossSigningVerified: false });
    await act(async () => {
      mockMx.emit(event, ...(args as never[]));
    });

    await waitFor(() => expect(result.current).toBe(VerificationStatus.Unverified));
    expect(getDeviceVerificationStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores device updates for a different user', async () => {
    const { result } = renderHook(() => useDeviceVerificationStatus(crypto, USER_ID, DEVICE_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current).toBe(VerificationStatus.Verified));

    await act(async () => {
      mockMx.emit(CryptoEvent.DevicesUpdated, ...(['@other:example.org'] as never[]));
      mockMx.emit(CryptoEvent.UserTrustStatusChanged, ...(['@other:example.org', {}] as never[]));
    });

    expect(getDeviceVerificationStatus).toHaveBeenCalledTimes(1);
  });
});

describe('useUnverifiedDeviceCount', () => {
  beforeEach(() => {
    getDeviceVerificationStatus.mockReset();
  });

  it('counts only devices that are not cross-signing verified', async () => {
    getDeviceVerificationStatus.mockImplementation((_userId: string, deviceId: string) =>
      Promise.resolve({ crossSigningVerified: deviceId === 'VERIFIED' })
    );

    const { result } = renderHook(
      () => useUnverifiedDeviceCount(crypto, USER_ID, ['VERIFIED', 'UNVERIFIED1', 'UNVERIFIED2']),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current).toBe(2));
  });

  it('returns 0 without a crypto api', () => {
    const { result } = renderHook(() => useUnverifiedDeviceCount(undefined, USER_ID, [DEVICE_ID]), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBe(0);
    expect(getDeviceVerificationStatus).not.toHaveBeenCalled();
  });
});
