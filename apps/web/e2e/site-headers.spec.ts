// The site's headers (public/_headers), which the dev server sends as production does: the
// desktop and the Messenger, its avatars, QR code and sockets, run under the Content Security
// Policy without it refusing anything. Explorer's own spec does the same for its pages.
import { expect, test } from '@playwright/test'

test('the desktop and the Messenger run under the site policy', async ({ page }) => {
  const refused: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) refused.push(message.text())
  })
  const response = await page.goto('/')
  const headers = response?.headers() ?? {}
  expect(headers['content-security-policy']).toContain("script-src 'self'")
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('no-referrer')

  await page.getByRole('button', { name: 'Pigeon Messenger' }).first().dblclick()
  const messenger = page.getByRole('dialog', { name: 'Pigeon', exact: true })
  await messenger.getByRole('textbox', { name: 'Your name:' }).fill('Rook')
  await messenger.getByRole('button', { name: 'OK' }).click()
  await page
    .getByRole('dialog', { name: 'Make a Recovery Key' })
    .getByRole('button', { name: 'Later' })
    .click()
  await messenger.getByRole('button', { name: 'Add a Friend' }).click()
  const addFriend = page.getByRole('dialog', { name: 'Add a Friend' })
  await addFriend.getByRole('tab', { name: 'Quick code' }).click()
  await expect(addFriend.getByRole('img', { name: 'Invite code as a QR code' })).toBeVisible()
  // A Lighthouse on this computer is allowed; nothing listens there, so it just fails to connect.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const socket = new WebSocket('ws://127.0.0.1:9/')
        socket.onclose = () => resolve()
      }),
  )
  expect(refused).toEqual([])
})
