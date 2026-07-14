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

export const createSessionTokenRefresher = async (
  session: Session,
  mx: MatrixClient
): Promise<TokenRefresher | undefined> => {
  if (!session.oidc || !session.refreshToken) return undefined;

  const metadata: ValidatedAuthMetadata = await mx.getAuthMetadata();

  const oauth2 = new OAuth2(metadata, {
    clientId: session.oidc.clientId,
    redirectUri: getAppOrigin(),
    deviceId: session.deviceId,
  });

  const onRefresh = async (tokens: AccessTokens): Promise<void> => {
    updateSessionTokens(session.userId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInMs: tokens.expiry ? tokens.expiry.getTime() - Date.now() : undefined,
    });
    // Only the active session owns the single service-worker session.
    const activeSessionId = getLocalStorageItem<string | undefined>(ACTIVE_SESSION_KEY, undefined);
    if (activeSessionId === session.userId) {
      pushSessionToSW(session.baseUrl, tokens.accessToken, session.userId);
    }
  };

  const tokenRefresher = new TokenRefresher(oauth2, onRefresh);
  const refresh = tokenRefresher.tokenRefreshFunction;
  // Another tab may have rotated the token; reusing a consumed one revokes the session.
  tokenRefresher.tokenRefreshFunction = (refreshToken) =>
    refresh(getStoredSessionRefreshToken(session.userId) ?? refreshToken);
  return tokenRefresher;
};
