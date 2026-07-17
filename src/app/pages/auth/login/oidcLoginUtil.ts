import to from 'await-to-js';
import type { OidcClientConfig, BearerTokenResponse } from '$types/matrix-sdk';
import {
  createClient,
  registerOidcClient,
  generateOidcAuthorizationUrl,
  completeAuthorizationCodeGrant,
} from '$types/matrix-sdk';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { createLogger } from '$utils/debug';
import type { Session } from '$state/sessions';
import {
  TAURI_OIDC_CLIENT_URI,
  buildTauriOidcRedirectUrl,
  rememberTauriOidcServer,
} from '$pages/auth/SSOTauri';

const log = createLogger('oidcLogin');

const CLIENT_NAME = 'Sable';

export enum OidcLoginError {
  RegistrationFailed = 'RegistrationFailed',
  UserCancelled = 'UserCancelled',
  CodeExchangeFailed = 'CodeExchangeFailed',
  MissingDeviceId = 'MissingDeviceId',
  Unknown = 'Unknown',
}

export class OidcLoginFailure extends Error {
  public constructor(public readonly code: OidcLoginError) {
    super(code);
    this.name = 'OidcLoginFailure';
  }
}

export const startOidcLogin = async (
  authMetadata: OidcClientConfig,
  homeserverUrl: string,
  redirectUri: string,
  opts?: { prompt?: string; server?: string }
): Promise<void> => {
  const tauri = isTauri();
  const effectiveRedirectUri = tauri ? buildTauriOidcRedirectUrl() : redirectUri;

  const [registerErr, clientId] = await to(
    registerOidcClient(authMetadata, {
      clientName: CLIENT_NAME,
      clientUri: tauri ? TAURI_OIDC_CLIENT_URI : window.location.origin,
      applicationType: tauri ? 'native' : 'web',
      redirectUris: [effectiveRedirectUri],
      contacts: undefined,
      tosUri: undefined,
      policyUri: undefined,
    })
  );
  if (registerErr || !clientId) {
    log.error('OIDC client registration failed', registerErr);
    throw new OidcLoginFailure(OidcLoginError.RegistrationFailed);
  }

  const authUrl = await generateOidcAuthorizationUrl({
    metadata: authMetadata,
    clientId,
    homeserverUrl,
    redirectUri: effectiveRedirectUri,
    nonce: crypto.randomUUID(),
    prompt: opts?.prompt,
  });

  if (tauri) {
    // Auth happens in the system browser and returns via the sable:// deep link.
    rememberTauriOidcServer(opts?.server);
    await openUrl(authUrl);
    return;
  }

  window.location.assign(authUrl);
};

const DEVICE_SCOPE_RE = /urn:matrix:(?:org\.matrix\.msc2967\.)?client:device:(\S+)/;

export const deviceIdFromScope = (scope: string): string | undefined =>
  DEVICE_SCOPE_RE.exec(scope)?.[1];

export const expiresInMsFromToken = (token: BearerTokenResponse): number | undefined => {
  if (typeof token.expires_in === 'number') return token.expires_in * 1000;
  if (typeof token.expires_at === 'number') return token.expires_at * 1000 - Date.now();
  return undefined;
};

export type OidcLoginResult = {
  baseUrl: string;
  session: Session;
};

export const completeOidcLogin = async (code: string, state: string): Promise<OidcLoginResult> => {
  const [grantErr, grant] = await to(completeAuthorizationCodeGrant(code, state));
  if (grantErr || !grant) {
    log.error('OIDC code exchange failed', grantErr);
    throw new OidcLoginFailure(OidcLoginError.CodeExchangeFailed);
  }

  const { tokenResponse, homeserverUrl, oidcClientSettings, idTokenClaims } = grant;

  const mx = createClient({ baseUrl: homeserverUrl, accessToken: tokenResponse.access_token });
  const [whoamiErr, whoami] = await to(mx.whoami());
  if (whoamiErr || !whoami?.user_id) {
    log.error('OIDC whoami failed', whoamiErr);
    throw new OidcLoginFailure(OidcLoginError.Unknown);
  }

  // Prefer the server-authoritative device id; fall back to the one carried in the granted scope.
  const deviceId = whoami.device_id ?? deviceIdFromScope(tokenResponse.scope);
  if (!deviceId) {
    throw new OidcLoginFailure(OidcLoginError.MissingDeviceId);
  }

  const session: Session = {
    baseUrl: homeserverUrl,
    userId: whoami.user_id,
    deviceId,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresInMs: expiresInMsFromToken(tokenResponse),
    oidc: {
      issuer: oidcClientSettings.issuer,
      clientId: oidcClientSettings.clientId,
      idTokenClaims,
    },
  };

  return { baseUrl: homeserverUrl, session };
};
