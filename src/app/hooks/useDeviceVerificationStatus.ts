import { useCallback, useEffect } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CryptoApi, type CryptoEventHandlerMap, CryptoEvent } from '$types/matrix-sdk';
import { verifiedDevice } from '$utils/matrix-crypto';
import { useMatrixClient } from './useMatrixClient';
import { useDeviceListChange } from './useDeviceList';

export const useCrossSigningKeysChange = (
  onChange: CryptoEventHandlerMap[CryptoEvent.KeysChanged]
) => {
  const mx = useMatrixClient();
  useEffect(() => {
    mx.on(CryptoEvent.KeysChanged, onChange);
    return () => {
      mx.removeListener(CryptoEvent.KeysChanged, onChange);
    };
  }, [mx, onChange]);
};

// onUserIdentityUpdated only emits KeysChanged for our own identity, so another user's
// cross-signing status changes are observable through this event alone.
export const useUserTrustStatusChange = (
  onChange: CryptoEventHandlerMap[CryptoEvent.UserTrustStatusChanged]
) => {
  const mx = useMatrixClient();
  useEffect(() => {
    mx.on(CryptoEvent.UserTrustStatusChanged, onChange);
    return () => {
      mx.removeListener(CryptoEvent.UserTrustStatusChanged, onChange);
    };
  }, [mx, onChange]);
};

export enum VerificationStatus {
  Unknown,
  Unverified,
  Verified,
  Unsupported,
}

const DEVICE_VERIFICATION_QUERY_KEY = 'device-verification';

// Every sliding sync response carrying device_lists re-emits DevicesUpdated, and each check is a
// full ed25519 cross-signing verification in wasm. Cache per device so repeated consumers share
// one result and we only re-verify when the device list or cross-signing keys actually change.
const deviceVerificationQuery = (
  crypto: CryptoApi | undefined,
  userId: string,
  deviceId: string | undefined
) => ({
  queryKey: [DEVICE_VERIFICATION_QUERY_KEY, userId, deviceId ?? ''],
  queryFn: async () => {
    if (!crypto || !deviceId) return null;
    return verifiedDevice(crypto, userId, deviceId);
  },
  enabled: Boolean(crypto) && Boolean(deviceId),
  staleTime: Infinity,
});

const useInvalidateDeviceVerification = (userId: string): void => {
  const queryClient = useQueryClient();

  useDeviceListChange(
    useCallback(
      (userIds) => {
        if (userIds.includes(userId)) {
          queryClient.invalidateQueries({ queryKey: [DEVICE_VERIFICATION_QUERY_KEY, userId] });
        }
      },
      [queryClient, userId]
    )
  );

  useCrossSigningKeysChange(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: [DEVICE_VERIFICATION_QUERY_KEY] });
    }, [queryClient])
  );

  useUserTrustStatusChange(
    useCallback(
      (changedUserId) => {
        queryClient.invalidateQueries({
          queryKey: [DEVICE_VERIFICATION_QUERY_KEY, changedUserId],
        });
      },
      [queryClient]
    )
  );
};

const toVerificationStatus = (verified: boolean | null | undefined): VerificationStatus => {
  if (verified === undefined) return VerificationStatus.Unknown;
  if (verified === null) return VerificationStatus.Unsupported;
  return verified ? VerificationStatus.Verified : VerificationStatus.Unverified;
};

export const useDeviceVerificationStatus = (
  crypto: CryptoApi | undefined,
  userId: string,
  deviceId: string | undefined
): VerificationStatus => {
  useInvalidateDeviceVerification(userId);

  const { data } = useQuery(deviceVerificationQuery(crypto, userId, deviceId));

  return toVerificationStatus(data);
};

export const useUnverifiedDeviceCount = (
  crypto: CryptoApi | undefined,
  userId: string,
  devices: string[]
): number | undefined => {
  useInvalidateDeviceVerification(userId);

  return useQueries({
    queries: devices.map((deviceId) => deviceVerificationQuery(crypto, userId, deviceId)),
    combine: (results) => {
      if (!crypto) return 0;
      if (results.some((result) => result.isPending)) return undefined;
      return results.filter((result) => result.data === false).length;
    },
  });
};
