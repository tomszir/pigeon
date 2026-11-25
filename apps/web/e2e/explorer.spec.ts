// Pigeon Explorer on this computer (decision 0032): it opens at the bundled start page in a
// sandboxed frame in quirks mode, says nobody is hosting anyone else's page, and goes back. On the desktop and on
// the Pocket. Needs no network.
import { devices, expect, type Page, test } from '@playwright/test'

/** Anything the page's Content Security Policy refused, which would mean the frame broke. */
function blockedLoads(page: Page): string[] {
  const blocked: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) blocked.push(message.text())
  })
  return blocked
}

async function browse(page: Page, explorer: ReturnType<Page['getByRole']>) {
  const frame = explorer.locator('iframe')
  await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin')
  await expect(page.frameLocator('iframe').locator('body')).toContainText('Pigeonweb')
  // No doctype, so the page is in quirks mode, as pages of the time were.
  const mode = await page
    .frameLocator('iframe')
    .locator('body')
    .evaluate((body) => body.ownerDocument.compatMode)
  expect(mode).toBe('BackCompat')
  await expect(explorer.getByRole('status')).toContainText('On this computer')

  const address = explorer.getByRole('textbox', { name: 'Address' })
  await address.fill('mika')
  await address.press('Enter')
  await expect(
    explorer.getByRole('heading', { name: "This page isn't being hosted right now" }),
  ).toBeVisible()
  await expect(address).toHaveValue('pigeon://mika')

  await explorer.getByRole('button', { name: 'Back' }).click()
  await expect(address).toHaveValue('pigeon://home')
  await expect(page.frameLocator('iframe').locator('body')).toContainText('Pigeonweb')
}

test('Explorer opens its start page on the desktop', async ({ page }) => {
  const blocked = blockedLoads(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Pigeon menu' }).click()
  await page
    .getByRole('menuitem', { name: /Pigeon Explorer/ })
    .first()
    .click()
  await browse(page, page.getByRole('dialog', { name: 'Pigeon Explorer' }))
  expect(blocked).toEqual([])
})

/** A Pixel 7 in the same Chromium, since a group can't change the browser. */
const { defaultBrowserType: _, ...pixel7 } = devices['Pixel 7']

test.describe('on the Pocket', () => {
  test.use(pixel7)

  test('Explorer opens its start page on a phone', async ({ page }) => {
    const blocked = blockedLoads(page)
    await page.goto('/')
    const keys = page.getByRole('navigation', { name: 'Pocket keys' })
    await keys.getByRole('button', { name: 'Right soft key: Menu' }).tap()
    await page
      .getByRole('menuitem', { name: /Pigeon Explorer/ })
      .first()
      .tap()
    const explorer = page.getByRole('region', { name: 'Pigeon Explorer' })
    await expect(explorer.getByRole('button', { name: 'Home' })).toBeInViewport()
    await browse(page, explorer)
    expect(blocked).toEqual([])
  })
})
