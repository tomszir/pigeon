// Changing your name from File > Change My Name in the real app: the form closes, the buddy list
// shows the new name at once, and it is still there after Pigeon is reopened. The form is a branch
// of the buddy list that closes itself when it saves, which once made the save throw and do nothing.
import { expect, type Page, test } from '@playwright/test'

const messengerOf = (page: Page) => page.getByRole('dialog', { name: 'Pigeon', exact: true })

async function openMessenger(page: Page) {
  await page.getByRole('button', { name: 'Pigeon Messenger' }).first().dblclick()
  return messengerOf(page)
}

test('a changed name is saved and shown', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const messenger = await openMessenger(page)
  await messenger.getByRole('textbox', { name: 'Your name:' }).fill('Rook')
  await messenger.getByRole('button', { name: 'OK' }).click()
  await page
    .getByRole('dialog', { name: 'Make a Recovery Key' })
    .getByRole('button', { name: 'Later' })
    .click()
  await expect(messenger.getByText('Rook', { exact: true })).toBeVisible()

  await messenger.getByRole('menuitem', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Change my name...' }).click()
  await messenger.getByRole('textbox', { name: 'Your name:' }).fill('Rook II')
  await messenger.getByRole('button', { name: 'OK' }).click()
  await expect(messenger.getByText('Rook II', { exact: true })).toBeVisible()
  await expect(messenger.getByRole('textbox', { name: 'Your name:' })).toHaveCount(0)
  expect(errors).toEqual([])

  // Saved on this device, not just drawn: it is still the name after Pigeon starts again. The
  // save finishes in the background, so a reload straight after the form closes can beat it.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(1000)
    await page.reload()
    const again = await openMessenger(page)
    try {
      await expect(again.getByText('Rook II', { exact: true })).toBeVisible({ timeout: 10_000 })
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
})
