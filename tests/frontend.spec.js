// @ts-check
import { test, expect } from '@playwright/test';

const BASE_URL = 'https://aitrafficja.com';

// Bypass onboarding overlay on every test
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('wlz.onboarding.done', '1');
  });
});

// ── 1. Page load ──────────────────────────────────────────────────────────────
test('page loads with 200 and correct title', async ({ page }) => {
  const res = await page.goto(BASE_URL);
  expect(res.status()).toBe(200);
  await expect(page).toHaveTitle(/traffic|whitelinez|ai/i);
});

// ── 2. Core layout elements ───────────────────────────────────────────────────
test('header logo is visible', async ({ page }) => {
  await page.goto(BASE_URL);
  const logo = page.locator('.site-header .logo-icon').first();
  await expect(logo).toBeVisible();
});

test('dev banner is visible', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page.locator('#dev-banner')).toBeVisible();
});

test('dev banner close button dismisses it', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('.dev-banner-close').click();
  await expect(page.locator('#dev-banner')).toBeHidden();
});

// ── 3. Count widget ───────────────────────────────────────────────────────────
test('count widget is visible on stream', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page.locator('.count-widget')).toBeVisible();
});

test('count widget total element exists', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page.locator('#cw-total')).toBeVisible();
});

// ── 4. Leaderboard window tabs ────────────────────────────────────────────────
test('leaderboard window tab buttons are present', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page.locator('[data-win="60"]')).toBeAttached();
  await expect(page.locator('[data-win="180"]')).toBeAttached();
  await expect(page.locator('[data-win="300"]')).toBeAttached();
});

test('switching leaderboard window tabs works', async ({ page }) => {
  // Tab panels are mobile-only (JS guard: if (!isMobile()) return)
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE_URL);
  // Open leaderboard panel
  await page.locator('.tab-btn[data-tab="leaderboard"]').click();
  await page.waitForTimeout(300);
  // Switch to 3MIN window
  const tab3min = page.locator('[data-win="180"]');
  await tab3min.click();
  await page.waitForTimeout(300);
  await expect(tab3min).toHaveClass(/active/);
});

// ── 5. Login modal ────────────────────────────────────────────────────────────
test('login modal opens on login button click', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#btn-open-login').click();
  await expect(page.locator('#login-modal')).toBeVisible();
});

test('login modal closes on backdrop click', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#btn-open-login').click();
  await expect(page.locator('#login-modal')).toBeVisible();
  // Click top-left corner of viewport — outside the centered modal card
  await page.mouse.click(10, 10);
  await expect(page.locator('#login-modal')).toBeHidden();
});

test('login modal closes on X button', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.locator('#btn-open-login').click();
  await page.locator('#login-modal-close').click();
  await expect(page.locator('#login-modal')).toBeHidden();
});

// ── 6. Stream panel ───────────────────────────────────────────────────────────
test('stream video panel is present', async ({ page }) => {
  await page.goto(BASE_URL);
  await expect(page.locator('#stream-panel, .stream-panel, #video-wrapper').first()).toBeVisible();
});

// ── 7. Sidebar tabs ───────────────────────────────────────────────────────────
test('sidebar tab buttons are present and switch panels on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE_URL);
  const tabs = page.locator('.tab-btn');
  expect(await tabs.count()).toBeGreaterThan(1);

  // Click the leaderboard tab — JS only fires on mobile (<768px)
  await page.locator('.tab-btn[data-tab="leaderboard"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('.tab-btn[data-tab="leaderboard"]')).toHaveClass(/active/);
});

// ── 8. No console errors ──────────────────────────────────────────────────────
test('no critical JS errors on load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(BASE_URL);
  await page.waitForTimeout(2000);
  const critical = errors.filter(e =>
    !e.includes('HLS') &&
    !e.includes('stream') &&
    !e.includes('net::ERR')
  );
  expect(critical).toHaveLength(0);
});

// ── 9. Gov overlay ────────────────────────────────────────────────────────────
test('gov overlay opens from trigger button', async ({ page }) => {
  await page.goto(BASE_URL);
  const govBtn = page.locator('#gov-open-btn, [data-open="gov"], .nav-icon-admin').first();
  if (await govBtn.count() > 0) {
    await govBtn.click();
    await expect(page.locator('#gov-overlay, .gov-overlay').first()).toBeVisible({ timeout: 5000 });
  } else {
    test.skip();
  }
});

// ── 10. Responsive — mobile viewport ─────────────────────────────────────────
test('layout is usable at 375px width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE_URL);
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('.count-widget')).toBeVisible();
});
