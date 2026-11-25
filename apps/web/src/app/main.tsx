import type { Invite } from '@pigeon/core'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { createBrowserBack } from '../platform/back/browser-back.ts'
import { BackContext } from '../ui/back/back.ts'
import '../ui/tokens.css'
import type { Messenger } from '../apps/messenger/service/service.ts'
import { copyText } from '../platform/clipboard/browser-clipboard.ts'
import { browserClock } from '../platform/clock/browser-clock.ts'
import { createBrowserStore } from '../platform/storage/browser-storage.ts'
import type { Store } from '../platform/storage/storage.ts'
import { browserTabLock } from '../platform/tab-lock/tab-lock.ts'
import { createShell } from '../shell/shell/shell.tsx'
import { brandIcon, tangoIcon } from '../ui/icons/icons.ts'
import { takeDeviceLinkFromAddress, takeInviteFromAddress } from './address-invite.ts'
import { createBrowserEnv, deviceName, loadFonts, needsHomeScreen } from './browser-env.ts'
import { createPrograms } from './programs.tsx'
import { startMessenger } from './start-messenger.ts'
import { rememberVersion, updatedSinceLastVisit } from './whats-new.ts'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html is missing #root')

await loadFonts()

// Pigeon draws its own menus; the browser's only shows where you can type or select text,
// so Copy and Paste still work there (docs/design.md, "Friends").
document.addEventListener('contextmenu', (event) => {
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, [contenteditable], [data-selectable]') != null) return
  event.preventDefault()
})

render(() => {
  // Before the invite is read, so its own entry in the history is marked first (decision 0034).
  const back = createBrowserBack()
  const env = createBrowserEnv()
  const { api, Shell } = createShell(env)
  const [messenger, setMessenger] = createSignal<Messenger | undefined>(undefined)
  const [problem, setProblem] = createSignal<string | undefined>(undefined)
  // ?demo opens the Desktop board's sample conversation (docs/roadmap.md, M1).
  const sample = new URLSearchParams(window.location.search).has('demo')
  const homeScreen = needsHomeScreen()
  const incoming = takeInviteFromAddress()
  // A link from Link a Device on your other device (decision 0024).
  const linking = takeDeviceLinkFromAddress()
  const programs = createPrograms(
    api,
    env,
    {
      messenger,
      problem,
      copyText,
      sleep: browserClock.sleep,
      // Linked: start again as the identity this device now speaks for.
      restart: () => location.reload(),
      startOver: (target) => startOver(target),
    },
    sample,
    homeScreen,
  )

  if (incoming === undefined && linking === undefined) programs.openReadme()
  if (linking !== undefined) programs.openJoinDevice(linking)
  if (sample) {
    programs.openMessenger()
    programs.openConversation('mika')
  }

  const showInvite = (invite: Invite | undefined) => {
    if (invite === undefined) return
    programs.openMessenger()
    programs.openAddFriend(invite)
  }
  // A link followed in a tab where Pigeon is already open only changes the hash. Listening from
  // the start catches one followed while the Messenger is still starting: Add a Friend says so
  // until it's ready.
  window.addEventListener('hashchange', () => {
    showInvite(takeInviteFromAddress())
    const device = takeDeviceLinkFromAddress()
    if (device !== undefined) programs.openJoinDevice(device)
  })

  // After an update, a returning visitor is told once, in place of the welcome (decision 0025).
  // It waits before the Messenger starts, which makes the identity a first visit lacks.
  const tellWhatsNew = async (store: Store) => {
    const version = __PIGEON_VERSION__
    if (!(await updatedSinceLastVisit(store, version)) || incoming !== undefined) return
    api.notify({
      title: "What's new",
      icon: brandIcon('pigeon-16'),
      body: `Pigeon was updated to ${version}. See what's new?`,
      onClick: programs.openChangelog,
    })
    await rememberVersion(store, version)
  }

  // On an iPhone in a Safari tab, once: storage lasts 7 days there (decision 0026).
  const HINTED = 'homeScreenHinted'
  const hintHomeScreen = async (store: Store) => {
    if (!homeScreen || (await store.get(HINTED)) === true) return
    api.notify({
      title: 'Keep Pigeon on this iPhone',
      icon: tangoIcon('dialog-warning', 16),
      body: 'Safari forgets Pigeon after 7 days away. Add it to your Home Screen to keep your friends. How?',
      onClick: programs.openHomeScreen,
    })
    await store.set(HINTED, true)
  }

  // Relay-only fails closed: no relay means no connections, and the visitor is told why. A
  // reconnect joins many rooms, so it's said once a minute at most.
  let saidNoRelay = 0
  const sayNoRelay = () => {
    if (Date.now() - saidNoRelay < 60_000) return
    saidNoRelay = Date.now()
    api.notify({
      title: 'The relay can’t be reached',
      icon: tangoIcon('dialog-warning', 16),
      body: 'Always go through the relay is on, so Pigeon won’t connect to friends directly. Turn it off in Settings, Connection, to connect without it.',
    })
  }

  // pagehide fires for closing, reloading and navigating away, including on phones.
  window.addEventListener('pagehide', () => messenger()?.goodbye())

  const stopMessenger = async () => {
    const running = messenger()
    setMessenger(undefined)
    running?.goodbye()
    await running?.close()
  }

  // One tab at a time (decision 0028): another tab's Pigeon is the same device, so this one
  // waits behind a screen that says so, and "Use Pigeon Here" moves Pigeon over.
  const ELSEWHERE = 'Pigeon is open in another tab.'
  const lock = browserTabLock(async () => {
    // Forgetting this Pigeon (0035) finishes, reload and all, before another tab may have it.
    if (startingOver !== undefined) await startingOver.catch(() => undefined)
    await stopMessenger()
    setProblem('Pigeon moved to another tab.')
    offerHere('Pigeon moved to another tab')
  })
  let storage: { readonly store: Store; readonly persistent: boolean } | undefined
  const offerHere = (title: string) =>
    api.setElsewhere({
      title,
      onTakeOver: () => {
        api.setElsewhere(undefined)
        void lock.takeOver().then(() => {
          setProblem(undefined)
          if (storage !== undefined) void run(storage, false)
        })
      },
    })

  // "Make This a New Device" on a copied profile, or leaving this Pigeon for another (0035):
  // forget everything here and link it again, to the other one's code if there is one.
  const JOIN_ON_START = 'joinOnStart'
  const isInvite = (value: unknown): value is Invite =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Invite).code === 'string' &&
    ['string', 'undefined'].includes(typeof (value as Invite).fingerprint)
  let startingOver: Promise<void> | undefined
  const startOver = (target?: Invite) => {
    // Only the tab running Pigeon may forget it; one that let go would clear another's store.
    if (storage === undefined || messenger() === undefined || startingOver !== undefined)
      return Promise.resolve()
    startingOver = forgetAndLink(storage, target)
    return startingOver
  }
  const forgetAndLink = async (opened: NonNullable<typeof storage>, target?: Invite) => {
    await stopMessenger()
    await opened.store.clear()
    const join =
      target === undefined
        ? true
        : {
            code: target.code,
            ...(target.fingerprint === undefined ? {} : { fingerprint: target.fingerprint }),
          }
    await opened.store.set(JOIN_ON_START, join)
    location.reload()
  }

  const run = async (opened: NonNullable<typeof storage>, first: boolean) => {
    if (first) {
      await tellWhatsNew(opened.store).catch((error: unknown) => console.error(error))
      if (opened.persistent)
        await hintHomeScreen(opened.store).catch((error: unknown) => console.error(error))
    }
    // Also when Pigeon moves here from another tab after the reload: whichever tab runs it first.
    const join = await opened.store.get(JOIN_ON_START)
    if (join !== undefined) {
      await opened.store.delete(JOIN_ON_START)
      programs.openJoinDevice(isInvite(join) ? join : undefined)
    }
    const started = await startMessenger(programs.messengerEvents, opened, sayNoRelay, deviceName())
    if (!started.ok) {
      setProblem(started.problem)
      return
    }
    setMessenger(started.messenger)
    if (!first) return
    if (!started.persistent)
      api.notify({
        title: 'Pigeon will forget you',
        icon: tangoIcon('dialog-warning', 16),
        body: 'This browser won’t let Pigeon store anything, so your name and friends last only until you close the tab.',
      })
    showInvite(incoming)
  }

  void createBrowserStore()
    .then(async (opened) => {
      storage = opened
      if (!(await lock.tryHold())) {
        setProblem(ELSEWHERE)
        offerHere('Pigeon is open in another tab')
        return
      }
      await run(opened, true)
    })
    .catch((error: unknown) => {
      setProblem('Pigeon couldn’t start in this browser.')
      console.error(error)
    })

  api.notify({
    title: 'Welcome to Pigeon',
    icon: tangoIcon('dialog-information', 16),
    body:
      incoming === undefined
        ? 'Have a look at Read Me.txt first, or open Pigeon Messenger to add a friend.'
        : 'Someone sent you an invite. Pigeon is asking them who they are.',
  })

  return (
    <BackContext.Provider value={back}>
      <Shell {...programs} />
    </BackContext.Provider>
  )
}, root)
