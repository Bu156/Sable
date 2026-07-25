import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const CLIENT_READY_TIMEOUT = 30_000;

export class AppShell {
  readonly leaveRoomPrompt: Locator;

  readonly createRoomButton: Locator;

  constructor(readonly page: Page) {
    this.leaveRoomPrompt = page.getByText('Are you sure you want to leave this room?');
    this.createRoomButton = page.getByRole('button', { name: 'Create Room' }).first();
  }

  async open(): Promise<void> {
    await this.page.goto('/');
    await expect(this.room('General')).toBeVisible({ timeout: CLIENT_READY_TIMEOUT });
    await this.dismissDeviceBanner();
  }

  room(name: string): Locator {
    return this.page.getByText(name).first();
  }

  async dismissDeviceBanner(): Promise<void> {
    await this.page
      .getByRole('button', { name: 'Dismiss' })
      .click({ timeout: 5_000 })
      .catch(() => undefined);
  }

  async openRoomOptions(name: string): Promise<RoomOptionsMenu> {
    await this.room(name).hover();
    await this.page.getByRole('button', { name: 'More Options' }).first().click();
    return new RoomOptionsMenu(this.page);
  }
}

export class RoomOptionsMenu {
  constructor(readonly page: Page) {}

  async leaveRoom(): Promise<void> {
    await this.page.getByRole('button', { name: 'Leave Room' }).click();
  }
}
