// Mail through the official Lighthouses, over the real internet: Rook removes Mika while her
// Pigeon is closed, then closes his own, so the two never meet again. When Mika opens Pigeon, the
// farewell can only have come through the mailbox, and she sees that Rook removed her.
import { expect, type Page, test } from '@playwright/test'

const messengerOf = (page: Page) => page.getByRole('dialog', { name: 'Pigeon', exact: true })

async function openMessenger(page: Page) {
  await page.getByRole('button', { name: 'Pigeon Messenger' }).first().dblclick()
  return messengerOf(page)
}

test('a farewell left in the mailbox reaches a friend who was offline', async ({ browser }) => {
  test.setTimeout(240_000)
  const rookContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const rook = await rookContext.newPage()
  await rook.goto('/')
  const rookMessenger = await openMessenger(rook)
  await rookMessenger.getByRole('textbox', { name: 'Your name:' }).fill('Rook')
  await rookMessenger.getByRole('button', { name: 'OK' }).click()
  await rook
    .getByRole('dialog', { name: 'Make a Recovery Key' })
    .getByRole('button', { name: 'Later' })
    .click()
  await rookMessenger.getByRole('button', { name: 'Add a Friend' }).click()
  await rook
    .getByRole('dialog', { name: 'Add a Friend' })
    .getByRole('button', { name: 'Copy link' })
    .click()
  const invite = String(await rook.evaluate('navigator.clipboard.readText()'))

  const mikaContext = await browser.newContext()
  const mika = await mikaContext.newPage()
  await mika.goto(invite.slice(invite.indexOf('/#') + 1))
  const add = mika.getByRole('dialog', { name: 'Add a Friend' })
  await add.getByRole('textbox', { name: 'Your name:' }).fill('Mika')
  await add.getByRole('button', { name: 'OK' }).click()
  await add.getByRole('button', { name: 'Add Rook' }).click()
  await expect(mika.getByRole('dialog', { name: 'Rook - Conversation' })).toContainText(
    'became friends',
  )
  // Long enough for each to hear the other's sealing key and Lighthouses.
  await expect(rookMessenger.getByRole('button', { name: /Mika/ })).toBeVisible()
  await rook.waitForTimeout(6000)

  // Mika closes Pigeon. Rook removes her, which leaves the farewell in her mailbox, then closes his.
  await mika.close()
  await rookMessenger.getByRole('button', { name: /Mika/ }).click({ button: 'right' })
  await rook.getByRole('menuitem', { name: 'Remove Friend...' }).click()
  await rook
    .getByRole('dialog', { name: 'Remove Friend' })
    .getByRole('button', { name: 'Remove' })
    .click()
  await expect(rookMessenger.getByRole('button', { name: /Mika/ })).toBeHidden()
  // A put to each Lighthouse in turn, each waiting up to 15 s for its answer.
  await rook.waitForTimeout(15_000)
  await rook.close()

  // Mika opens Pigeon again: Rook isn't there to tell her, so only the mailbox can. Pigeon
  // looks for mail as it starts, so a start whose first look failed is tried again.
  const back = await mikaContext.newPage()
  for (let attempt = 0; attempt < 3; attempt++) {
    await back.goto('/')
    const mikaMessenger = await openMessenger(back)
    const rookThere = mikaMessenger.getByRole('button', { name: /Rook/ })
    try {
      await expect(rookThere).toContainText('removed you', { timeout: 30_000 })
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
})
