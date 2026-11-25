// The phone layout on a touch phone: Today first, soft keys and a home key, the
// menu from the bottom right, one window at a time, and the keys stepping aside while typing.
import { devices, expect, test } from '@playwright/test'

test.use({ ...devices['Pixel 7'] })

test('the Pocket runs Pigeon on a phone', async ({ page }) => {
  await page.goto('/?demo')
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
  await expect(page.getByRole('region', { name: 'Pigeon' })).toBeVisible()
  // One tap opens a friend; the buddy list closes behind the conversation.
  await page.getByRole('button', { name: /^Mika/ }).first().tap()
  const chat = page.getByRole('region', { name: 'Mika - Conversation (sample)' })
  await expect(chat).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pigeon' })).toHaveCount(0)
  await expect(keys.getByRole('button', { name: 'Left soft key: Friends' })).toBeVisible()

  // Typing hides the keys and keeps the field and Send on screen.
  const draft = chat.getByRole('textbox', { name: 'Message to Mika' })
  await draft.tap()
  await expect(keys).toBeHidden()
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeInViewport()
  await draft.fill('on my way')
  await chat.getByRole('button', { name: 'Send', exact: true }).tap()
  await expect(chat).toContainText('on my way')

  await page.getByRole('button', { name: 'Close Mika (sample)' }).tap()
  await expect(page.getByRole('region', { name: 'Today' })).toBeVisible()
})
