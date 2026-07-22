import type { AccessTokens, ValidatedAuthMetadata } from '$types/matrix-sdk';
import { OAuth2, TokenRefresher } from '$types/matrix-sdk';
import type { MatrixClient } from '$types/matrix-sdk';
import type { Session } from '$state/sessions';
import {
  ACTIVE_SESSION_KEY,
  getStoredSessionRefreshToken,
  updateSessionTokens,
} from '$state/sessions';
import { getLocalStorageItem } from '$state/utils/atomWithLocalStorage';
import { pushSessionToSW } from '../sw-session';
import { getAppOrigin } from '$utils/platform';

export const assertAuthMetadataIssuer = (
  expectedIssuer: string,
  metadata: ValidatedAuthMetadata
): void => {
  if (metadata.issuer !== expectedIssuer) {
    throw new Error(
      `OAuth issuer changed for the stored session: expected ${expectedIssuer}, received ${metadata.issuer}`
    );
  }
};

export type SessionTokenRefresher = Pick<TokenRefresher, 'tokenRefreshFunction'>;

export const createSessionTokenRefresher = (
  session: Session,
  mx: MatrixClient
): SessionTokenRefresher | undefined => {
  const { oidc } = session;
  if (!oidc || !session.refreshToken) return undefined;

  const onRefresh = async (tokens: AccessTokens): Promise<void> => {
    updateSessionTokens(session.userId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInMs: tokens.expiry ? tokens.expiry.getTime() - Date.now() : undefined,
    });
    // Only the active session owns the single service-worker session.
    const activeSessionId = getLocalStorageItem<string | undefined>(ACTIVE_SESSION_KEY, undefined);
    if (activeSessionId === session.userId) {
      await pushSessionToSW(session.baseUrl, tokens.accessToken, session.userId);
    }
  };

  let tokenRefresherPromise: Promise<TokenRefresher> | undefined;
  const getTokenRefresher = (): Promise<TokenRefresher> => {
    if (!tokenRefresherPromise) {
      tokenRefresherPromise = mx
        .getAuthMetadata()
        .then((metadata: ValidatedAuthMetadata) => {
          assertAuthMetadataIssuer(oidc.issuer, metadata);
          const oauth2 = new OAuth2(metadata, {
            clientId: oidc.clientId,
            redirectUri: getAppOrigin(),
            deviceId: session.deviceId,
          });
          return new TokenRefresher(oauth2, onRefresh);
        })
        .catch((error: unknown) => {
          tokenRefresherPromise = undefined;
          throw error;
        });
    }
    return tokenRefresherPromise;
  };

  return {
    tokenRefreshFunction: async (refreshToken) => {
      const tokenRefresher = await getTokenRefresher();
      // Another tab may have rotated the token; reusing a consumed one revokes the session.
      const latestRefreshToken = getStoredSessionRefreshToken(session.userId) ?? refreshToken;
      const tokens = await tokenRefresher.tokenRefreshFunction(latestRefreshToken);
      return {
        ...tokens,
        // OAuth servers may omit a replacement refresh token, in which case the old one remains valid.
        refreshToken: tokens.refreshToken ?? latestRefreshToken,
      };
    },
  };
};
