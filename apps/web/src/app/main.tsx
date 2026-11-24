import type { Invite } from '@pigeon/core'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import '../ui/tokens.css'
import type { Messenger } from '../apps/messenger/service/service.ts'
import { copyText } from '../platform/clipboard/browser-clipboard.ts'
import { browserClock } from '../platform/clock/browser-clock.ts'
import { createBrowserStore } from '../platform/storage/browser-storage.ts'
import type { Store } from '../platform/storage/storage.ts'
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

  void createBrowserStore()
    .then(async (storage) => {
      await tellWhatsNew(storage.store).catch((error: unknown) => console.error(error))
      if (storage.persistent)
        await hintHomeScreen(storage.store).catch((error: unknown) => console.error(error))
      return startMessenger(programs.messengerEvents, storage, sayNoRelay, deviceName())
    })
    .then((started) => {
      if (!started.ok) {
        setProblem(started.problem)
        return
      }
      setMessenger(started.messenger)
      // pagehide fires for closing, reloading and navigating away, including on phones.
      window.addEventListener('pagehide', () => started.messenger.goodbye())
      if (!started.persistent)
        api.notify({
          title: 'Pigeon will forget you',
          icon: tangoIcon('dialog-warning', 16),
          body: 'This browser won’t let Pigeon store anything, so your name and friends last only until you close the tab.',
        })
      showInvite(incoming)
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

  return <Shell {...programs} />
}, root)
