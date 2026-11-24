// M13's check (decision 0024), in three browser contexts over the public relays: Rook, already
// friends with Mika, links a second device by code; Mika still sees one Rook, and a message sent
// from the second device shows on Rook's first device too.
import { expect, type Page, test } from '@playwright/test'

const messengerOf = (page: Page) => page.getByRole('dialog', { name: 'Pigeon', exact: true })

async function openMessenger(page: Page) {
  await page.getByRole('button', { name: 'Pigeon Messenger' }).first().dblclick()
  return messengerOf(page)
}

async function fileMenu(page: Page, item: string) {
  await messengerOf(page).getByRole('menuitem', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test('a second device is the same Rook, and its messages reach the first', async ({ browser }) => {
  const laptop = await (
    await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  ).newPage()
  await laptop.goto('/')
  const laptopMessenger = await openMessenger(laptop)
  await laptopMessenger.getByRole('textbox', { name: 'Your name:' }).fill('Rook')
  await laptopMessenger.getByRole('button', { name: 'OK' }).click()

  // Mika and Rook become friends first, so the phone gets Mika when it's linked.
  await laptopMessenger.getByRole('button', { name: 'Add a Friend' }).click()
  const addFriend = laptop.getByRole('dialog', { name: 'Add a Friend' })
  await addFriend.getByRole('button', { name: 'Copy link' }).click()
  const invite = String(await laptop.evaluate('navigator.clipboard.readText()'))
  const mika = await (await browser.newContext()).newPage()
  await mika.goto(invite.slice(invite.indexOf('/#') + 1))
  const mikaAdd = mika.getByRole('dialog', { name: 'Add a Friend' })
  await mikaAdd.getByRole('textbox', { name: 'Your name:' }).fill('Mika')
  await mikaAdd.getByRole('button', { name: 'OK' }).click()
  await mikaAdd.getByRole('button', { name: 'Add Rook' }).click()
  const mikaChat = mika.getByRole('dialog', { name: 'Rook - Conversation' })
  await expect(mikaChat).toContainText('Mika and Rook became friends on')
  const laptopChat = laptop.getByRole('dialog', { name: 'Mika - Conversation' })
  await expect(laptopChat).toBeVisible()

  // The laptop shows a code; the phone, a fresh browser, types it.
  await fileMenu(laptop, 'Link a Device...')
  const linkWindow = laptop.getByRole('dialog', { name: 'Link a Device' })
  const code = await linkWindow.locator('[data-link-code]').textContent()
  expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/)

  const phone = await (await browser.newContext()).newPage()
  await phone.goto('/')
  await openMessenger(phone)
  await fileMenu(phone, 'Link to My Other Device...')
  const join = phone.getByRole('dialog', { name: 'Link to My Other Device' })
  await join.getByRole('textbox', { name: 'Code or link:' }).fill(code ?? '')
  await join.getByRole('button', { name: 'Link' }).click()

  // Both show the same check; confirming on the laptop links the phone, which starts again.
  const phoneCheck = join.locator('[data-link-check]')
  await expect(phoneCheck).toHaveText(/^\d{3} \d{3}$/)
  await expect(linkWindow.locator('[data-link-check]')).toHaveText(
    (await phoneCheck.textContent()) ?? '',
  )
  await linkWindow.getByRole('button', { name: 'Link' }).click()
  await expect(linkWindow).toContainText('Linked.')
  await phone.waitForEvent('load')

  // The phone is Rook, with Mika on it.
  const phoneMessenger = await openMessenger(phone)
  await expect(phoneMessenger).toContainText('Rook')
  const mikaOnPhone = phoneMessenger.getByRole('button', { name: /Mika/ })
  await expect(mikaOnPhone).toBeVisible()
  await mikaOnPhone.dblclick()
  const phoneChat = phone.getByRole('dialog', { name: 'Mika - Conversation' })
  const draft = phoneChat.getByRole('textbox', { name: 'Message to Mika' })
  await draft.fill('this is my phone')
  await draft.press('Enter')

  // Mika gets it from Rook, still one Rook; the laptop shows it as Rook's own.
  await expect(mikaChat).toContainText('Rook says:')
  await expect(mikaChat).toContainText('this is my phone')
  const mikaMessenger = await openMessenger(mika)
  await expect(mikaMessenger.getByRole('button', { name: /Rook/ })).toHaveCount(1)
  await expect(laptopChat).toContainText('this is my phone')
  await expect(laptopChat).not.toContainText('Mika says:')
})
