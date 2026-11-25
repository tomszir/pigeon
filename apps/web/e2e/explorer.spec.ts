// Pigeon Explorer on this computer (decision 0032): it opens at the bundled start page in a
// sandboxed frame in quirks mode, says nobody is hosting anyone else's page, and goes back. On the desktop and on
// the Pocket. Needs no network.
import { devices, expect, type Page, test } from '@playwright/test'
import { MEDIUM, viewStylesheet } from '../src/apps/explorer/page-frame/view.ts'

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

test('Explorer follows the start page to Help and on into it', async ({ page }) => {
  const blocked = blockedLoads(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Pigeon menu' }).click()
  await page
    .getByRole('menuitem', { name: /Pigeon Explorer/ })
    .first()
    .click()
  const explorer = page.getByRole('dialog', { name: 'Pigeon Explorer' })
  const frame = page.frameLocator('iframe')
  const address = explorer.getByRole('textbox', { name: 'Address' })
  await frame.getByRole('link', { name: 'Pigeon Help' }).click()
  // Explorer spells an address without its trailing slash.
  await expect(address).toHaveValue('pigeon://help')
  await expect(frame.locator('body')).toContainText('How Pigeon Works')
  await expect(explorer.getByRole('status')).toContainText('On this computer')
  await frame.getByRole('link', { name: 'How Pigeon Works' }).first().click()
  await expect(address).toHaveValue(/^pigeon:\/\/help\/./)
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

  test('pages open in One Column on a phone, with nothing to scroll sideways', async ({ page }) => {
    await page.goto('/')
    const keys = page.getByRole('navigation', { name: 'Pocket keys' })
    await keys.getByRole('button', { name: 'Right soft key: Menu' }).tap()
    await page
      .getByRole('menuitem', { name: /Pigeon Explorer/ })
      .first()
      .tap()
    const explorer = page.getByRole('region', { name: 'Pigeon Explorer' })
    const frame = page.frameLocator('iframe')
    const address = explorer.getByRole('textbox', { name: 'Address' })
    await expect(explorer.getByRole('status')).toContainText('One Column')

    /** The page fits the frame's width, and its table cells are stacked. */
    const fits = async () => {
      const body = frame.locator('body')
      await expect(body).not.toBeEmpty()
      const { overflow, cell } = await body.evaluate((element) => {
        const doc = element.ownerDocument
        const td = doc.querySelector('td')
        return {
          overflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
          cell: td === null ? 'block' : doc.defaultView?.getComputedStyle(td).display,
        }
      })
      expect(overflow).toBeLessThanOrEqual(1)
      expect(cell).toBe('block')
    }

    await fits()
    for (const to of ['pigeon://help/', 'pigeon://help/protocol/']) {
      await address.fill(to)
      await address.press('Enter')
      await fits()
    }
    // A flows page, whose ASCII diagrams scroll inside their own box instead.
    await frame.getByRole('link', { name: 'Linking a device' }).click()
    await fits()
    const diagram = await frame
      .locator('pre')
      .first()
      .evaluate((pre) => pre.ownerDocument.defaultView?.getComputedStyle(pre).overflowX)
    expect(diagram).toBe('auto')
  })

  test('One Column holds markup of the time that would push a page wider than a phone', async ({
    page,
  }) => {
    const long = 'a line of words that goes on and on '.repeat(20)
    const markup = [
      `<table><tr><td nowrap>${long}</td></tr></table>`,
      `<p style="white-space:nowrap">${long}</p>`,
      '<div style="min-width:760px">wide</div>',
      '<div style="width:760px;padding:20px;border:2px solid">padded</div>',
      '<table width="760" cellpadding="10"><tr><td width="200">nav</td><td>text</td></tr></table>',
      '<div style="margin-left:210px">beside a column</div>',
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="900" height="300">',
    ].join('')
    const css = viewStylesheet({ mode: 'one-column', text: MEDIUM }, true)
    // No doctype, so quirks mode, as Explorer writes pages.
    await page.setContent(`<style>${css}</style>${markup}<pre>${long}</pre>`)
    const { overflow, margin } = await page.locator('html').evaluate((html) => {
      const doc = html.ownerDocument
      return {
        overflow: html.scrollWidth - html.clientWidth,
        margin: doc.querySelectorAll('div')[2]?.getBoundingClientRect().left ?? 0,
      }
    })
    expect(overflow).toBeLessThanOrEqual(1)
    expect(margin).toBeLessThan(20)
  })
})
