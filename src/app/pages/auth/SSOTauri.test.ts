import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildTauriSsoRedirectUrl,
  parseTauriOidcCallback,
  parseTauriSsoCallback,
  rememberTauriSsoNonce,
  takeTauriSsoNonce,
} from './SSOTauri';

vi.mock('@tauri-apps/plugin-os', () => ({
  type: vi.fn<() => string>(() => 'android'),
}));

beforeEach(() => {
  localStorage.clear();
});

describe('buildTauriSsoRedirectUrl', () => {
  it('embeds the server and stores the same nonce it puts in the url', () => {
    const url = new URL(buildTauriSsoRedirectUrl('https://hs.example'));
    expect(url.searchParams.get('server')).toBe('https://hs.example');
    const nonce = url.searchParams.get('sso_nonce');
    expect(nonce).toBeTruthy();
    expect(takeTauriSsoNonce()).toBe(nonce);
  });

  it('omits the server when none is provided but still sets a nonce', () => {
    const url = new URL(buildTauriSsoRedirectUrl());
    expect(url.searchParams.get('server')).toBeNull();
    expect(url.searchParams.get('sso_nonce')).toBeTruthy();
  });
});

describe('takeTauriSsoNonce', () => {
  it('returns the stored nonce once, then undefined', () => {
    rememberTauriSsoNonce('abc');
    expect(takeTauriSsoNonce()).toBe('abc');
    expect(takeTauriSsoNonce()).toBeUndefined();
  });
});

describe('parseTauriSsoCallback', () => {
  it('round-trips loginToken, server and nonce from a built redirect', () => {
    const redirect = buildTauriSsoRedirectUrl('https://hs.example');
    const nonce = takeTauriSsoNonce();
    expect(parseTauriSsoCallback(`${redirect}&loginToken=tok_123`)).toEqual({
      loginToken: 'tok_123',
      server: 'https://hs.example',
      nonce,
    });
  });

  it('rejects the wrong protocol', () => {
    expect(parseTauriSsoCallback('https://login/lp/sso-callback?loginToken=x')).toBeUndefined();
  });

  it('rejects a missing loginToken', () => {
    expect(parseTauriSsoCallback('sable://login/lp/sso-callback?server=x')).toBeUndefined();
  });
});

describe('parseTauriOidcCallback', () => {
  it('parses code and state', () => {
    expect(parseTauriOidcCallback('moe.sable.app:/login?code=c1&state=s1')).toEqual({
      code: 'c1',
      state: 's1',
    });
  });

  it('rejects the wrong path', () => {
    expect(parseTauriOidcCallback('moe.sable.app:/other?code=c1&state=s1')).toBeUndefined();
  });
});
