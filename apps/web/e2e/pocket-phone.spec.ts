// The phone layout on a touch phone: Today first, soft keys and a home key, the
// menu from the bottom right, one window at a time, and the keys stepping aside while typing.
// The chat is with a real friend, Rook on a desktop, paired by his quick code over the public
// relays, so this needs the internet.
import { type Browser, devices, expect, type Page, test } from '@playwright/test'

test.use({ ...devices['Pixel 7'] })

/** Rook on a desktop, named, with Add a Friend's quick code showing: its link, to open. */
async function rookShowsAQuickCode(browser: Browser): Promise<{ rook: Page; link: string }> {
  const rook = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage()
  await rook.goto('/')
  await rook.getByRole('button', { name: 'Pigeon Messenger' }).first().dblclick()
  const messenger = rook.getByRole('dialog', { name: 'Pigeon', exact: true })
  await messenger.getByRole('textbox', { name: 'Your name:' }).fill('Rook')
  await messenger.getByRole('button', { name: 'OK' }).click()
  await rook
    .getByRole('dialog', { name: 'Make a Recovery Key' })
    .getByRole('button', { name: 'Later' })
    .click()
  await messenger.getByRole('button', { name: 'Add a Friend' }).click()
  const add = rook.getByRole('dialog', { name: 'Add a Friend' })
  await add.getByRole('tab', { name: 'Quick code' }).click()
  const shown = add.locator('[data-invite-link]')
  await expect(shown).toBeVisible()
  return { rook, link: (await shown.getAttribute('data-invite-link')) ?? '' }
}

test('the Pocket runs Pigeon on a phone', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  const keys = page.getByRole('navigation', { name: 'Pocket keys' })
  await expect(page.getByRole('region', { name: 'Today' })).toContainText('Good')
  await expect(keys.getByRole('button', { name: 'Home: Today' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // Every key is at least 44px tall.
  for (const name of ['Left soft key: Messenger', 'Home: Today', 'Right soft key: Menu']) {
    const box = await keys.getByRole('button', { name }).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  await keys.getByRole('button', { name: 'Right soft key: Menu' }).tap()
  const menu = page.getByRole('menu', { name: 'Pigeon menu' })
  await expect(menu).toBeVisible()
  const menuBox = await menu.boundingBox()
  const viewport = page.viewportSize()
  // Anchored bottom right, over the Menu key.
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeGreaterThan((viewport?.width ?? 0) - 20)
  await keys.getByRole('button', { name: 'Right soft key: Close' }).tap()
  await expect(menu).toBeHidden()

  await keys.getByRole('button', { name: 'Left soft key: Messenger' }).tap()
  const pigeon = page.getByRole('region', { name: 'Pigeon' })
  await expect(pigeon).toBeVisible()
  await pigeon.getByRole('textbox', { name: 'Your name:' }).fill('Mika')
  await pigeon.getByRole('button', { name: 'OK' }).tap()
  await page.getByRole('button', { name: 'Later' }).tap()

  // Mika opens Rook's quick code, as scanning it would, and adds him: their chat opens.
  const { rook, link } = await rookShowsAQuickCode(browser)
  await page.goto(link.slice(link.indexOf('/#') + 1))
  const add = page.getByRole('region', { name: 'Add a Friend' })
  await expect(add).toContainText('Rook wants to be your friend', { timeout: 60_000 })
  await add.getByRole('button', { name: 'Add Rook' }).tap()
  const chat = page.getByRole('region', { name: 'Rook - Conversation' })
  await expect(chat).toBeVisible({ timeout: 30_000 })
  await expect(keys.getByRole('button', { name: 'Left soft key: Friends' })).toBeVisible()

  // From the list, one tap opens a friend; the buddy list closes behind the conversation.
  await keys.getByRole('button', { name: 'Left soft key: Friends' }).tap()
  await page.getByRole('button', { name: /^Rook/ }).first().tap()
  await expect(chat).toBeVisible()
  await expect(pigeon).toHaveCount(0)

  // Typing hides the keys and keeps the field and Send on screen.
  const draft = chat.getByRole('textbox', { name: 'Message to Rook' })
  await draft.tap()
  await expect(keys).toBeHidden()
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
  await draft.fill('on my way')
  await chat.getByRole('button', { name: 'Send', exact: true }).tap()
  await expect(chat).toContainText('on my way')

  await page.getByRole('button', { name: 'Close Rook' }).tap()
  await expect(page.getByRole('region', { name: 'Today' })).toBeVisible()
  await rook.close()
})
