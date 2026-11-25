// An invite link through the official Lighthouses, over the real internet: Rook makes a link and
// closes Pigeon; Mika opens it and asks, and closes hers; Rook opens Pigeon and adds her, and
// closes it again; Mika opens Pigeon and Rook is her friend. They're never online together.
import { expect, type Page, test } from '@playwright/test'

const messengerOf = (page: Page) => page.getByRole('dialog', { name: 'Pigeon', exact: true })

async function openMessenger(page: Page) {
  await page.getByRole('button', { name: 'Pigeon Messenger' }).first().dblclick()
  return messengerOf(page)
}

async function named(page: Page, name: string) {
  const messenger = await openMessenger(page)
  await messenger.getByRole('textbox', { name: 'Your name:' }).fill(name)
  await messenger.getByRole('button', { name: 'OK' }).click()
  await page
    .getByRole('dialog', { name: 'Make a Recovery Key' })
    .getByRole('button', { name: 'Later' })
    .click()
  return messenger
}

/** Opens Pigeon until `check` holds: a start whose first look at the Lighthouses failed tries again. */
async function reopen(
  page: Page,
  check: (messenger: ReturnType<typeof messengerOf>) => Promise<void>,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto('/')
    const messenger = await openMessenger(page)
    try {
      await check(messenger)
      return messenger
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
  throw new Error('unreachable')
}

test('two people who are never online together become friends through a link', async ({
  browser,
}) => {
  test.setTimeout(300_000)
  const rookContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const rook = await rookContext.newPage()
  await rook.goto('/')
  const rookMessenger = await named(rook, 'Rook')
  await rookMessenger.getByRole('button', { name: 'Add a Friend' }).click()
  const addFriend = rook.getByRole('dialog', { name: 'Add a Friend' })
  await addFriend.getByRole('button', { name: 'Make link' }).click()
  await expect(addFriend.getByRole('list', { name: 'Your invite links' })).toBeVisible({
    timeout: 60_000,
  })
  const copied = String(await rook.evaluate('navigator.clipboard.readText()'))
  expect(copied).toMatch(/^Rook invites you to Pigeon!\nhttp\S+#a\/[a-z2-7]{52}$/)
  const link = copied.slice(copied.indexOf('\n') + 1)
  await rook.close()

  const mikaContext = await browser.newContext()
  const mika = await mikaContext.newPage()
  await mika.goto(link.slice(link.indexOf('/#') + 1))
  const add = mika.getByRole('dialog', { name: 'Add a Friend' })
  await add.getByRole('textbox', { name: 'Your name:' }).fill('Mika')
  await add.getByRole('button', { name: 'OK' }).click()
  await expect(add).toContainText('This link is from Rook', { timeout: 60_000 })
  await add.getByRole('button', { name: 'Ask to be friends' }).click()
  await expect(add).toContainText('Your request is waiting for Rook', { timeout: 60_000 })
  await mika.close()

  // Rook opens Pigeon: Mika's request waits in Add a Friend.
  const rookBack = await rookContext.newPage()
  await reopen(rookBack, async (messenger) => {
    await messenger.getByRole('button', { name: 'Add a Friend' }).click()
    await expect(rookBack.getByRole('dialog', { name: 'Add a Friend' })).toContainText(
      'Mika asks to be friends',
      { timeout: 45_000 },
    )
  })
  const requests = rookBack.getByRole('dialog', { name: 'Add a Friend' })
  await requests.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(messengerOf(rookBack).getByRole('button', { name: /Mika/ })).toBeVisible()
  // A put to each Lighthouse in turn, each waiting up to 15 s for its answer.
  await rookBack.waitForTimeout(15_000)
  await rookBack.close()

  // Mika opens Pigeon, and Rook is her friend.
  const mikaBack = await mikaContext.newPage()
  await reopen(mikaBack, async (messenger) => {
    await expect(messenger.getByRole('button', { name: /Rook/ })).toBeVisible({ timeout: 45_000 })
  })
})
