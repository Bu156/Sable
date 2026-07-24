import { test, expect, type Page } from '@playwright/test';

const containerised = Boolean(process.env.PW_TEST_CONNECT_WS_ENDPOINT);

async function dismissDeviceBanner(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Dismiss' })
    .click({ timeout: 5_000 })
    .catch(() => undefined);
}

const maskDynamic = (page: Page) => ({
  mask: [page.locator('time'), page.getByText(/^Created by /)],
});

test.describe('app shell', () => {
  test('shows seeded rooms after login', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('General').first()).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText('Random').first()).toBeVisible();
  });

  test('opens a room and renders its timeline', async ({ page }) => {
    await page.goto('/');
    await dismissDeviceBanner(page);

    await page.getByText('General').first().click();
    await expect(page.getByText('Welcome to the test room.')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText('Layout baseline seed message.')).toBeVisible();
  });

  test('matches the shell layout baseline', async ({ page }) => {
    test.skip(!containerised, 'run via pnpm test:e2e:docker');

    await page.goto('/');
    await expect(page.getByText('General').first()).toBeVisible({ timeout: 180_000 });
    await dismissDeviceBanner(page);

    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page).toHaveScreenshot('shell.png', maskDynamic(page));
  });
});
