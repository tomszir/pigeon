import type { Invite } from '@pigeon/core'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import '../ui/tokens.css'
import type { Messenger } from '../apps/messenger/service/service.ts'
import { copyText } from '../platform/clipboard/browser-clipboard.ts'
import { browserClock } from '../platform/clock/browser-clock.ts'
import { createShell } from '../shell/shell/shell.tsx'
import { tangoIcon } from '../ui/icons/icons.ts'
import { takeInviteFromAddress } from './address-invite.ts'
import { createBrowserEnv, loadFonts } from './browser-env.ts'
import { createPrograms } from './programs.tsx'
import { startMessenger } from './start-messenger.ts'

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
  const incoming = takeInviteFromAddress()
  const programs = createPrograms(
    api,
    env,
    { messenger, problem, copyText, sleep: browserClock.sleep },
    sample,
  )

  if (incoming === undefined) programs.openReadme()
  if (sample) {
    programs.openMessenger()
    programs.openConversation('mika')
  }

  void startMessenger(programs.messengerEvents)
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
      const showInvite = (invite: Invite | undefined) => {
        if (invite === undefined) return
        programs.openMessenger()
        programs.openAddFriend(invite)
      }
      showInvite(incoming)
      // A link followed in a tab where Pigeon is already open only changes the hash.
      window.addEventListener('hashchange', () => showInvite(takeInviteFromAddress()))
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
