import { invoke } from '@tauri-apps/api/core';

export async function listDistributors(): Promise<string[]> {
  return invoke<string[]>('plugin:unifiedpush|list_distributors');
}

export async function setDistributor(name: string): Promise<void> {
  await invoke('plugin:unifiedpush|set_distributor', { name });
}

export async function registerForPushNotifications(): Promise<string> {
  return invoke<string>('plugin:unifiedpush|register_for_push_notifications');
}

export async function unregisterForPushNotifications(): Promise<void> {
  await invoke('plugin:unifiedpush|unregister_for_push_notifications');
}

export async function setToken(token: string): Promise<void> {
  await invoke('plugin:unifiedpush|set_token', { token });
}
