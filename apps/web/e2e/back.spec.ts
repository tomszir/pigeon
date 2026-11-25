// Back steps back inside Pigeon: the browser's own Back goes back a page in
// Explorer, closes an open menu, and on the Pocket closes the window to Today; with nothing left
// it leaves the site. The desktop's windows stay open. Needs no network.
import { devices, expect, type Page, test } from '@playwright/test'

/** The browser's own Back, as a phone's back gesture or key presses it. */
const back = (page: Page) => page.goBack({ waitUntil: 'commit' })

/**
 * Opens Pigeon on the desktop and waits for Read Me, which a first visit opens once Pigeon's
 * storage is open: before then it could open between a test's steps.
 */
async function openDesktop(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: 'Read Me.txt - Pigeon Reader' })).toBeVisible()
}

/** Pigeon's address is still the one it was opened at, so Back hasn't left the site. */
async function stillHere(page: Page) {
  await expect(page).toHaveURL(/localhost|127\.0\.0\.1/)
}

test('on the desktop, Back goes back a page and closes menus, but not windows', async ({
  page,
}) => {
  await openDesktop(page)
  await page.getByRole('button', { name: 'Pigeon menu' }).click()
  await expect(page.getByRole('menuitem', { name: /Pigeon Explorer/ }).first()).toBeVisible()
  await back(page)
  await expect(page.getByRole('menuitem', { name: /Pigeon Explorer/ })).toHaveCount(0)
  await stillHere(page)

  await page.getByRole('button', { name: 'Pigeon menu' }).click()
  await page
    .getByRole('menuitem', { name: /Pigeon Explorer/ })
    .first()
    .click()
  const explorer = page.getByRole('dialog', { name: 'Pigeon Explorer' })
  const address = explorer.getByRole('textbox', { name: 'Address' })
  await page.frameLocator('iframe').getByRole('link', { name: 'Pigeon Help' }).click()
  await expect(address).toHaveValue('pigeon://help')

  // A menu in Explorer's own menu bar closes first.
  await explorer.getByRole('menuitem', { name: 'View' }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: /One Column/ })).toBeVisible()
  await back(page)
  await expect(page.getByRole('menuitemcheckbox', { name: /One Column/ })).toHaveCount(0)
  await expect(address).toHaveValue('pigeon://help')

  await back(page)
  await expect(address).toHaveValue('pigeon://home')
  await expect(explorer).toBeVisible()

  // Explorer's own Back and the browser's stay in step: forward, back by the button, and the
  // browser's Back then has nothing of Explorer's left, so it leaves.
  await explorer.getByRole('button', { name: 'Forward' }).click()
  await expect(address).toHaveValue('pigeon://help')
  await explorer.getByRole('button', { name: 'Back' }).click()
  await expect(address).toHaveValue('pigeon://home')
  await back(page)
  await expect(page).toHaveURL('about:blank')
})

test('going to the page already showing adds no step, and an invite link adds none', async ({
  page,
}) => {
  await openDesktop(page)
  await page.getByRole('button', { name: 'Pigeon menu' }).click()
  await page
    .getByRole('menuitem', { name: /Pigeon Explorer/ })
    .first()
    .click()
  const explorer = page.getByRole('dialog', { name: 'Pigeon Explorer' })
  await expect(explorer.getByRole('textbox', { name: 'Address' })).toHaveValue('pigeon://home')
  // The menu's step goes back out of the history on its own, a moment after it closes: until it
  // has, a new entry would land under that move and be stepped over.
  await expect.poll(() => page.evaluate('history.state?.pigeonBack')).toBe(0)
  await explorer.getByRole('button', { name: 'Home' }).click()
  // An invite link followed in this tab: a new entry, taken out of the address at once.
  await page.evaluate("location.hash = '#i/not-an-invite'")
  // Pigeon takes it out of the address once it has read it; Back before then races it.
  await expect(page).not.toHaveURL(/#i\//)
  // One press: it passes the link's entry, which isn't Pigeon's, and Home added none, so Pigeon
  // goes on out of the site by itself. A second press would race that move.
  await back(page)
  await expect(page).toHaveURL('about:blank')
})

test('a desktop menu left open closes when the screen turns into the Pocket', async ({ page }) => {
  await openDesktop(page)
  await page.getByRole('button', { name: 'Pigeon menu' }).click()
  await page.setViewportSize({ width: 412, height: 839 })
  await expect(page.getByRole('region', { name: 'Today' })).toBeVisible()
  // Its step went with it, so a single Back leaves.
  await back(page)
  await expect(page).toHaveURL('about:blank')
})

/** A Pixel 7 in the same Chromium, since a group can't change the browser. */
const { defaultBrowserType: _, ...pixel7 } = devices['Pixel 7']

test.describe('on the Pocket', () => {
  test.use(pixel7)

  test('Back goes back a page, then closes the window to Today, then leaves', async ({ page }) => {
    await page.goto('/')
    const keys = page.getByRole('navigation', { name: 'Pocket keys' })
    const today = page.getByRole('region', { name: 'Today' })

    await keys.getByRole('button', { name: 'Right soft key: Menu' }).tap()
    await expect(page.getByRole('menu', { name: 'Pigeon menu' })).toBeVisible()
    await back(page)
    await expect(page.getByRole('menu', { name: 'Pigeon menu' })).toHaveCount(0)
    await stillHere(page)

    await keys.getByRole('button', { name: 'Right soft key: Menu' }).tap()
    await page
      .getByRole('menuitem', { name: /Pigeon Explorer/ })
      .first()
      .tap()
    const explorer = page.getByRole('region', { name: 'Pigeon Explorer' })
    const address = explorer.getByRole('textbox', { name: 'Address' })
    await page.frameLocator('iframe').getByRole('link', { name: 'Pigeon Help' }).tap()
    await expect(address).toHaveValue('pigeon://help')

    await back(page)
    await expect(address).toHaveValue('pigeon://home')
    await back(page)
    await expect(explorer).toHaveCount(0)
    await expect(today).toBeVisible()
    await stillHere(page)
    await back(page)
    await expect(page).toHaveURL('about:blank')
  })

  test('a window closed by its own button takes its step with it', async ({ page }) => {
    await page.goto('/')
    const keys = page.getByRole('navigation', { name: 'Pocket keys' })
    await keys.getByRole('button', { name: 'Right soft key: Menu' }).tap()
    await page
      .getByRole('menuitem', { name: /Pigeon Explorer/ })
      .first()
      .tap()
    const explorer = page.getByRole('region', { name: 'Pigeon Explorer' })
    await expect(explorer).toBeVisible()
    await explorer.getByRole('button', { name: 'Close Pigeon Explorer' }).tap()
    await expect(page.getByRole('region', { name: 'Today' })).toBeVisible()
    // Nothing of Pigeon's is left to step back from, so Back leaves at once.
    await back(page)
    await expect(page).toHaveURL('about:blank')
  })

  test('asleep, Back wakes the Pocket, and the window and its pages are still there', async ({
    page,
  }) => {
    await page.goto('/')
    const keys = page.getByRole('navigation', { name: 'Pocket keys' })
    await keys.getByRole('button', { name: 'Right soft key: Menu' }).tap()
    await page
      .getByRole('menuitem', { name: /Pigeon Explorer/ })
      .first()
      .tap()
    const explorer = page.getByRole('region', { name: 'Pigeon Explorer' })
    const address = explorer.getByRole('textbox', { name: 'Address' })
    await page.frameLocator('iframe').getByRole('link', { name: 'Pigeon Help' }).tap()
    await expect(address).toHaveValue('pigeon://help')

    await keys.getByRole('button', { name: 'Right soft key: Menu' }).tap()
    await page.getByRole('menuitem', { name: 'Turn off the Pocket' }).tap()
    const standby = page.getByLabel('The Pocket is asleep. Tap to wake it.')
    await expect(standby).toBeVisible()
    await back(page)
    await expect(standby).toHaveCount(0)
    await expect(address).toHaveValue('pigeon://help')

    await back(page)
    await expect(address).toHaveValue('pigeon://home')
    await back(page)
    await expect(page.getByRole('region', { name: 'Today' })).toBeVisible()
  })
})
