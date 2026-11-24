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
  const rookContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const mikaContext = await browser.newContext()
  const rook = await fresh(rookContext)

  const rookMessenger = await openMessenger(rook)
  await chooseName(rookMessenger, 'Rook')
  await rookMessenger.getByRole('button', { name: 'Add a Friend' }).click()
  const addFriend = rook.getByRole('dialog', { name: 'Add a Friend' })
  await expect(addFriend.locator('[data-invite-code]')).toHaveText(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/)
  await expect(addFriend.getByRole('img', { name: 'Invite link as a QR code' })).toBeVisible()
  await addFriend.getByRole('button', { name: 'Copy link' }).click()
  const link = String(await rook.evaluate('navigator.clipboard.readText()'))
  expect(link).toMatch(/#i\/[a-z2-7]{21}$/)

  // Mika opens the link in a browser of her own; the link vouches for Rook's fingerprint.
  const mika = await fresh(mikaContext, link.slice(link.indexOf('/#') + 1))
  const mikaAdd = mika.getByRole('dialog', { name: 'Add a Friend' })
  await chooseName(mikaAdd, 'Mika')
  await expect(mikaAdd).toContainText('Rook wants to be your friend.')
  await expect(mikaAdd).toContainText('It matches the link')
  await mikaAdd.getByRole('button', { name: 'Add Rook' }).click()
  // Friends at once: both chats open, starting with when it happened.
  const mikaChat = mika.getByRole('dialog', { name: 'Rook - Conversation' })
  await expect(mikaChat).toContainText('Mika and Rook became friends on')
  await expect(mikaAdd).toBeHidden()
  await expect(rook.getByRole('dialog', { name: 'Mika - Conversation' })).toContainText(
    'Rook and Mika became friends on',
  )
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

  // A link followed in a tab where Pigeon is already open changes only the hash, and still opens.
  const samContext = await browser.newContext()
  const sam = await fresh(samContext)
  await expect(sam.getByRole('dialog', { name: 'Read Me.txt - Pigeon Reader' })).toBeVisible()
  await sam.goto(`/${link.slice(link.indexOf('#'))}`)
  const samAdd = sam.getByRole('dialog', { name: 'Add a Friend' })
  await expect(samAdd).toBeVisible()

  // Sam pairs with Rook by typing a fresh code instead, and is told to check the fingerprint.
  await chooseName(samAdd, 'Sam')
  // Rook's link is used up, so nobody answers; Sam gives up waiting.
  await expect(samAdd).toContainText('Looking for whoever made')
  await samAdd.getByRole('button', { name: 'Cancel' }).click()
  await rookChat.getByRole('button', { name: 'Close' }).click()
  await addFriend.getByRole('button', { name: 'Make a new invite' }).click()
  const code = (await addFriend.locator('[data-invite-code]').textContent()) ?? ''
  await samAdd
    .getByRole('textbox', { name: 'Type a code or paste a link:' })
    .fill(code.toLowerCase())
  await samAdd.getByRole('button', { name: 'Open' }).click()
  await expect(samAdd).toContainText('Rook wants to be your friend.')
  await expect(samAdd).toContainText('Check it before you add them')
  await samAdd.getByRole('button', { name: 'Add Rook' }).click()
  await expect(sam.getByRole('dialog', { name: 'Rook - Conversation' })).toContainText(
    'Sam and Rook became friends on',
  )
  await expect(rookMessenger.getByRole('button', { name: /Sam/ })).toBeVisible()

  await samContext.close()
  await rookContext.close()
  await mikaContext.close()
})
