import asyncio
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        pw = await async_api.async_playwright().start()
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )
        context = await browser.new_context()
        context.set_default_timeout(5000)
        page = await context.new_page()

        await page.goto("http://localhost:5173/", wait_until="commit", timeout=10000)
        await page.wait_for_timeout(3000)

        # Click the Leaderboard tab (button[2] in sidebar-tabs, aria-label="Leaderboard")
        lb_tab = page.locator('xpath=/html/body/main/aside/div/button[2]').nth(0)
        await lb_tab.click(timeout=5000)
        await page.wait_for_timeout(2000)

        # Click the 3MIN window button
        btn_3min = page.locator('button[data-win="180"]')
        await btn_3min.wait_for(state="visible", timeout=5000)
        await btn_3min.click(timeout=5000)
        await page.wait_for_timeout(2000)

        # Assertions: leaderboard panel with window buttons visible
        await expect(btn_3min).to_be_visible(timeout=3000)
        await expect(page.locator('#ranked-list').first).to_be_visible(timeout=3000)
        await asyncio.sleep(3)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
