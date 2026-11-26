// A message to a friend who's offline, over the real internet and the official Lighthouses:
// Mika closes Pigeon, Rook writes to her and closes his, and when Mika opens Pigeon again the
// message is there, though Rook isn't online to send it, in a section of what came by letter.
// The same as farewells take.
import { expect, type Page, test } from '@playwright/test'

const messengerOf = (page: Page) => page.getByRole('dialog', { name: 'Pigeon', exact: true })

async function openMessenger(page: Page) {
  await page.getByRole('button', { name: 'Pigeon Messenger' }).first().dblclick()
  return messengerOf(page)
}

test('a message written to a friend who is offline reaches them later', async ({ browser }) => {
  test.setTimeout(240_000)
  const rookContext = await browser.newContext()
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
  const addFriend = rook.getByRole('dialog', { name: 'Add a Friend' })
  await addFriend.getByRole('tab', { name: 'Quick code' }).click()
  const invite =
    (await addFriend.locator('[data-invite-link]').getAttribute('data-invite-link')) ?? ''

  const mikaContext = await browser.newContext()
  const mika = await mikaContext.newPage()
  await mika.goto(invite.slice(invite.indexOf('/#') + 1))
  const add = mika.getByRole('dialog', { name: 'Add a Friend' })
  await add.getByRole('textbox', { name: 'Your name:' }).fill('Mika')
  await add.getByRole('button', { name: 'OK' }).click()
  await add.getByRole('button', { name: 'Ask to be friends' }).click()
  // Rook sees Mika asking, with her fingerprint and bird, and adds her.
  await addFriend.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(mika.getByRole('dialog', { name: 'Rook - Conversation' })).toContainText(
    'became friends',
  )
  const chat = rook.getByRole('dialog', { name: 'Mika - Conversation' })
  await expect(chat).toBeVisible()
  // Long enough for each to hear the other's sealing key and Lighthouses.
  await rook.waitForTimeout(6000)

  // Mika closes Pigeon. Rook writes, sees it left at the Lighthouses, and closes his.
  await mika.close()
  await chat.getByRole('textbox', { name: 'Message to Mika' }).fill('are we still on for saturday?')
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(chat).toContainText('for when Mika', { timeout: 60_000 })
  await rook.close()

  // Mika opens Pigeon again, and the message is in her chat with Rook.
  const back = await mikaContext.newPage()
  for (let attempt = 0; attempt < 3; attempt++) {
    await back.goto('/')
    const mikaMessenger = await openMessenger(back)
    try {
      await expect(mikaMessenger.getByRole('button', { name: /Rook/ })).toContainText(
        'are we still on for saturday?',
        { timeout: 30_000 },
      )
      // Opened, the chat gathers what came while she was away under one heading, with an
      // envelope on the message and no line of its own under it.
      await mikaMessenger.getByRole('button', { name: /Rook/ }).dblclick()
      const letters = back.getByRole('dialog', { name: 'Rook - Conversation' })
      await expect(
        letters.getByRole('region', {
          name: /^While you were away · 1 message by letter, through .+$/,
        }),
      ).toContainText('are we still on for saturday?')
      await expect(letters.getByRole('button', { name: /^Came by letter, through / })).toBeVisible()
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
})
