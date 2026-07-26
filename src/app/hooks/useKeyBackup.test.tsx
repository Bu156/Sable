import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TypedEventEmitter } from 'matrix-js-sdk/lib/models/typed-event-emitter';
import type { CryptoApi } from '$types/matrix-sdk';
import { CryptoEvent } from '$types/matrix-sdk';
import { useSessionBackupKeyCached } from './useKeyBackup';

const emitter = new TypedEventEmitter<string, Record<string, (...args: never[]) => void>>();

vi.mock('$hooks/useMatrixClient', () => ({
  useMatrixClient: () => emitter,
}));

const createCrypto = (getSessionBackupPrivateKey: CryptoApi['getSessionBackupPrivateKey']) =>
  ({ getSessionBackupPrivateKey }) as unknown as CryptoApi;

describe('useSessionBackupKeyCached', () => {
  beforeEach(() => {
    emitter.removeAllListeners();
  });

  it('reports true when the key is in the crypto store', async () => {
    const crypto = createCrypto(
      vi.fn<CryptoApi['getSessionBackupPrivateKey']>().mockResolvedValue(new Uint8Array([1, 2, 3]))
    );

    const { result } = renderHook(() => useSessionBackupKeyCached(crypto));

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('reports false when the store has no key', async () => {
    const crypto = createCrypto(
      vi.fn<CryptoApi['getSessionBackupPrivateKey']>().mockResolvedValue(null)
    );

    const { result } = renderHook(() => useSessionBackupKeyCached(crypto));

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('reports false rather than hanging when the lookup rejects', async () => {
    const crypto = createCrypto(
      vi.fn<CryptoApi['getSessionBackupPrivateKey']>().mockRejectedValue(new Error('store closed'))
    );

    const { result } = renderHook(() => useSessionBackupKeyCached(crypto));

    await waitFor(() => expect(result.current).toBe(false));
  });

  it('re-checks once the key gets cached', async () => {
    const getKey = vi
      .fn<CryptoApi['getSessionBackupPrivateKey']>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(new Uint8Array([1]));
    const crypto = createCrypto(getKey);

    const { result } = renderHook(() => useSessionBackupKeyCached(crypto));
    await waitFor(() => expect(result.current).toBe(false));

    emitter.emit(CryptoEvent.KeyBackupDecryptionKeyCached as never);

    await waitFor(() => expect(result.current).toBe(true));
  });
});
