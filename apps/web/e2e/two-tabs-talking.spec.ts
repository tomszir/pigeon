// M2's check, in two browser contexts that share nothing but the public relays: pair by link,
// chat both ways, see typing, send a buzz, and keep it all after a reload.
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

async function openMessenger(page: Page) {
  await page.getByRole('button', { name: 'Pigeon Messenger' }).first().dblclick()
  return page.getByRole('dialog', { name: 'Pigeon', exact: true })
}

async function chooseName(scope: ReturnType<Page['getByRole']>, name: string) {
  await scope.getByRole('textbox', { name: 'Your name:' }).fill(name)
  await scope.getByRole('button', { name: 'OK' }).click()
}

async function fresh(context: BrowserContext, url = '/') {
  const page = await context.newPage()
  await page.goto(url)
  return page
}

test('two people pair by invite link and chat', async ({ browser }) => {
  const rookContext = await browser.newContext()
  const mikaContext = await browser.newContext()
  const rook = await fresh(rookContext)

  const rookMessenger = await openMessenger(rook)
  await chooseName(rookMessenger, 'Rook')
  await rookMessenger.getByRole('button', { name: 'Add a Friend' }).click()
  const addFriend = rook.getByRole('dialog', { name: 'Add a Friend' })
  const link = await addFriend.getByRole('textbox', { name: 'Invite link' }).inputValue()
  expect(link).toContain('#invite/')
  await expect(addFriend.getByRole('img', { name: 'Invite link as a QR code' })).toBeVisible()

  // Mika opens the link in a browser of her own.
  const mika = await fresh(mikaContext, link.slice(link.indexOf('/#') + 1))
  const mikaAdd = mika.getByRole('dialog', { name: 'Add a Friend' })
  await chooseName(mikaAdd, 'Mika')
  await expect(mikaAdd).toContainText('Rook invited you to be friends.')
  await mikaAdd.getByRole('button', { name: 'Pair' }).click()
  await expect(mikaAdd).toContainText('You and Rook are now friends.')
  await mikaAdd.getByRole('button', { name: 'Say hello' }).click()

  const mikaChat = mika.getByRole('dialog', { name: 'Rook - Conversation' })
  await expect(mikaChat).toContainText('direct, encrypted')
  const mikaDraft = mikaChat.getByRole('textbox', { name: 'Message to Rook' })
  await mikaDraft.fill('wait, there')
  await expect(rook.getByRole('status').filter({ hasText: 'Mika' }).first()).toBeVisible()

  await rookMessenger.getByRole('button', { name: /Mika/ }).dblclick()
  const rookChat = rook.getByRole('dialog', { name: 'Mika - Conversation' })
  await expect(rookChat).toContainText('Mika is writing a message...')

  await mikaDraft.fill("wait, there's really no server??")
  await mikaDraft.press('Enter')
  await expect(rookChat).toContainText("wait, there's really no server??")

  const rookDraft = rookChat.getByRole('textbox', { name: 'Message to Mika' })
  await rookDraft.fill('nope. your browser is talking straight to mine')
  await rookDraft.press('Enter')
  await expect(mikaChat).toContainText('nope. your browser is talking straight to mine')

  await rookChat.getByRole('button', { name: 'Buzz!' }).click()
  await expect(mikaChat).toContainText('Rook has just sent you a buzz!')

  // Leaving says goodbye, so Rook sees Mika go offline without waiting for a timeout; a reload
  // keeps the name, the friend and the chat.
  await mika.reload()
  await expect(rookChat).toContainText('Mika went offline at', { timeout: 5000 })
  const again = await openMessenger(mika)
  await expect(again).toContainText('Mika')
  await again.getByRole('button', { name: /Rook/ }).dblclick()
  await expect(mika.getByRole('dialog', { name: 'Rook - Conversation' })).toContainText(
    'nope. your browser is talking straight to mine',
  )

  await rookContext.close()
  await mikaContext.close()
})
