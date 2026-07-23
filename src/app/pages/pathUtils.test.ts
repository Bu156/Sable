import { describe, expect, it } from 'vitest';
import { getAppPathFromHref, getSettingsPath } from './pathUtils';

describe('getSettingsPath', () => {
  it('returns the settings root path', () => {
    expect(getSettingsPath()).toBe('/settings');
  });

  it('returns a section path with an optional focus query', () => {
    expect(getSettingsPath('devices')).toBe('/settings/devices');
    expect(getSettingsPath('appearance', 'message-link-preview')).toBe(
      '/settings/appearance?focus=message-link-preview'
    );
  });
});

describe('getAppPathFromHref', () => {
  it('extracts the app path for a matching browser-router origin', () => {
    expect(getAppPathFromHref('https://app.sable.moe/', 'https://app.sable.moe/')).toBe('/');
    expect(getAppPathFromHref('https://app.sable.moe/', 'https://app.sable.moe/login')).toBe(
      '/login'
    );
    expect(
      getAppPathFromHref('https://app.sable.moe/', 'https://app.sable.moe/home/room/%21abc')
    ).toBe('/home/room/%21abc');
  });

  it('extracts the app path for a matching hash-router origin', () => {
    expect(getAppPathFromHref('https://app.sable.moe/#/', 'https://app.sable.moe/#/')).toBe('/');
    expect(
      getAppPathFromHref('https://app.sable.moe/#/', 'https://app.sable.moe/#/login?code=c&state=s')
    ).toBe('/login?code=c&state=s');
  });

  it('returns empty when the href origin does not match the base', () => {
    expect(getAppPathFromHref('https://app.sable.moe/', 'https://tauri.localhost/')).toBe('');
    expect(
      getAppPathFromHref('https://app.sable.moe/', 'https://tauri.localhost/login?code=c&state=s')
    ).toBe('');
  });

  it('returns empty when a hash-router base is paired with a hashless href', () => {
    expect(getAppPathFromHref('https://app.sable.moe/#/', 'https://tauri.localhost/')).toBe('');
  });
});
