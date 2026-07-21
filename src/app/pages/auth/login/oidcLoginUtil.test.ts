import { describe, it, expect } from 'vitest';
import type { BearerTokenResponse } from '$types/matrix-sdk';
import { deviceIdFromScope, expiresInMsFromToken } from './oidcLoginUtil';

describe('deviceIdFromScope', () => {
  it('extracts the device id from the stable device scope', () => {
    const scope = 'openid urn:matrix:client:api:* urn:matrix:client:device:ABC123';
    expect(deviceIdFromScope(scope)).toBe('ABC123');
  });

  it('extracts the device id from the legacy msc2967 device scope', () => {
    const scope =
      'openid urn:matrix:org.matrix.msc2967.client:api:* urn:matrix:org.matrix.msc2967.client:device:XYZ789';
    expect(deviceIdFromScope(scope)).toBe('XYZ789');
  });

  it('returns undefined when no device scope is present', () => {
    expect(deviceIdFromScope('openid urn:matrix:client:api:*')).toBeUndefined();
  });
});

describe('expiresInMsFromToken', () => {
  it('converts expires_in (seconds → ms)', () => {
    const token = {
      access_token: 'x',
      token_type: 'Bearer',
      expires_in: 299,
    } as BearerTokenResponse;
    expect(expiresInMsFromToken(token)).toBe(299_000);
  });

  it('returns undefined when expires_in is absent', () => {
    expect(
      expiresInMsFromToken({ access_token: 'x', token_type: 'Bearer' } as BearerTokenResponse)
    ).toBeUndefined();
  });
});
