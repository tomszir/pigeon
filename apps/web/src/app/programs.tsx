// What's on the desktop and in the menu, and what each opens. Content lives in tables here; the
// shell draws it and the apps fill the windows.
import type { Invite, PeerId } from '@pigeon/core'
import { type Accessor, createSignal, Show } from 'solid-js'
import { About, SOURCE_URL } from '../apps/about/about/about.tsx'
import { AddFriend } from '../apps/messenger/add-friend/add-friend.tsx'
import { BuddyList } from '../apps/messenger/buddy-list/buddy-list.tsx'
import { LiveConversation } from '../apps/messenger/live-conversation/live-conversation.tsx'
import { SAMPLE_SELF, sampleConversation } from '../apps/messenger/sample/sample.ts'
import { SampleConversation } from '../apps/messenger/sample-conversation/sample-conversation.tsx'
import type { FriendView, Messenger, MessengerEvents } from '../apps/messenger/service/service.ts'
import { Readme } from '../apps/readme/readme/readme.tsx'
import type { ShellProps } from '../shell/shell/shell.tsx'
import type { Launcher, ShellApi, ShellEnv } from '../shell/shell/types.ts'
import { brandIcon, tangoIcon } from '../ui/icons/icons.ts'

export interface Programs extends ShellProps {
  readonly openReadme: () => void
  readonly openMessenger: () => void
  readonly openConversation: (contactId: string) => void
  readonly openAddFriend: (incoming?: Invite) => void
  readonly sample: Accessor<boolean>
  /** What the Messenger tells the desktop: balloons, buzzes, new friends. */
  readonly messengerEvents: MessengerEvents
}

/** What the Messenger needs from the composition root. */
export interface MessengerHost {
  readonly messenger: Accessor<Messenger | undefined>
  /** Why Pigeon can't run here, when it can't. */
  readonly problem: Accessor<string | undefined>
  readonly copyText: (text: string) => Promise<boolean>
  readonly sleep: (ms: number) => Promise<void>
}

/** Things that come in later milestones say so, in the world's own voice. */
const LATER = {
  letters: ['Letters is still being built.', 'Sealed letters carried by friends arrive soon.'],
  files: ['Shared Files is still being built.', 'Sending files to friends arrives soon.'],
  explorer: ['Pigeon Explorer is still being built.', 'Browsing pigeon:// pages arrives soon.'],
} as const

export function createPrograms(
  api: ShellApi,
  env: ShellEnv,
  host: MessengerHost,
  startWithSample: boolean,
): Programs {
  const [sample, setSample] = createSignal(startWithSample)

  const openAbout = () =>
    api.open('about', {
      title: 'About Pigeon',
      icon: brandIcon('pigeon-16'),
      bounds: { x: 322, y: 200, width: 380, height: 250 },
      controls: { minimize: false },
      content: (window) => <About onClose={window.close} />,
    })

  const openReadme = () =>
    api.open('readme', {
      title: 'Read Me.txt - Pigeon Reader',
      icon: tangoIcon('text-x-generic', 16),
      bounds: { x: 92, y: 16, width: 450, height: 480 },
      resizable: true,
      content: (window) => <Readme onClose={window.close} onAbout={openAbout} />,
    })

  // Each new conversation opens 20px down and right of the last, like the era's cascade, and
  // the first lands where the Desktop board draws it.
  let conversations = 0
  const cascade = () => {
    const step = conversations % 5
    conversations += 1
    return { x: 318 + step * 20, y: 116 + step * 20, width: 490, height: 540 }
  }
  const conversationWindow = (contactId: string) => `conversation:${contactId}`

  const openSampleConversation = (contactId: string) => {
    const conversation = sampleConversation(contactId)
    if (conversation === undefined) return
    api.open(`sample:${contactId}`, {
      title: `${conversation.name} - Conversation (sample)`,
      taskTitle: `${conversation.name} (sample)`,
      icon: brandIcon('pigeon-16'),
      bounds: cascade(),
      resizable: true,
      content: (window) => (
        <SampleConversation
          conversation={conversation}
          self={SAMPLE_SELF.name}
          onBuzz={window.buzz}
          onClose={window.close}
          onAbout={openAbout}
        />
      ),
    })
  }

  const openFriendConversation = (id: PeerId) => {
    const messenger = host.messenger()
    const friend = messenger?.friend(id)
    if (messenger === undefined || friend === undefined) return
    const windowId = conversationWindow(id)
    api.open(windowId, {
      title: `${friend.handle} - Conversation`,
      taskTitle: friend.handle,
      icon: brandIcon('pigeon-16'),
      bounds: cascade(),
      resizable: true,
      content: (window) => (
        <LiveConversation
          messenger={messenger}
          friend={id}
          isActive={window.isActive}
          onBuzz={window.buzz}
          onClose={window.close}
          onAbout={openAbout}
        />
      ),
    })
  }

  const openConversation = (contactId: string) =>
    sample() ? openSampleConversation(contactId) : openFriendConversation(contactId)

  const openAddFriend = (incoming?: Invite) => {
    // A link from the address bar replaces whatever the window was showing.
    if (incoming !== undefined) api.close('add-friend')
    api.open('add-friend', {
      title: 'Add a Friend',
      icon: tangoIcon('contact-new', 16),
      bounds: { x: 262, y: 150, width: 500, height: 330 },
      controls: { maximize: false },
      content: (window) => (
        <Show
          when={host.messenger()}
          fallback={<p>{host.problem() ?? 'Pigeon is still starting...'}</p>}
        >
          {(messenger) => (
            <AddFriend
              messenger={messenger()}
              incoming={incoming}
              copyText={host.copyText}
              sleep={host.sleep}
              onOpenConversation={(id) => {
                setSample(false)
                openFriendConversation(id)
              }}
              onClose={window.close}
            />
          )}
        </Show>
      ),
    })
  }

  const copyInvite = async () => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    if (messenger.invite() === undefined) await messenger.newInvite()
    const link = messenger.inviteLink()
    if (link === undefined) return
    const copied = await host.copyText(link)
    api.notify({
      title: copied ? 'Invite link copied' : 'Copy your invite link',
      icon: tangoIcon('contact-new', 16),
      body: copied
        ? 'Paste it to one friend. It works once, while Pigeon is open here.'
        : 'Your browser kept the clipboard to itself. Open Add a Friend and copy the link there.',
    })
  }

  const friendIcon = brandIcon('pigeon-16')
  const messengerEvents: MessengerEvents = {
    onPaired: (friend: FriendView) =>
      api.notify({
        title: `${friend.handle} is now your friend`,
        icon: friendIcon,
        body: `${friend.handle} answered your invite link.`,
      }),
    onOnline: (friend) =>
      api.notify({ title: friend.handle, icon: friendIcon, body: 'has just come online.' }),
    onMessage: (friend, entry) => {
      if (api.isActive(conversationWindow(friend.id))) return
      api.notify({
        title: `${friend.handle} says:`,
        icon: friendIcon,
        body: entry.text.slice(0, 120),
      })
    },
    onBuzz: (friend) => {
      if (!sample()) openFriendConversation(friend.id)
      api.buzz(conversationWindow(friend.id))
    },
  }

  const openMessenger = () =>
    api.open('messenger', {
      title: 'Pigeon',
      icon: brandIcon('pigeon-16'),
      bounds: { x: 818, y: 8, width: 200, height: 600 },
      resizable: true,
      controls: { maximize: false },
      content: (window) => (
        <BuddyList
          sample={sample()}
          messenger={host.messenger()}
          problem={host.problem()}
          onShowSample={() => setSample(true)}
          onHideSample={() => setSample(false)}
          onOpenConversation={openConversation}
          onAddFriend={() => openAddFriend()}
          onCopyInvite={() => void copyInvite()}
          onAbout={openAbout}
          onClose={window.close}
        />
      ),
    })

  const later = (title: string, text: readonly string[]) => () =>
    api.message({ title, kind: 'information', text })

  const messenger: Launcher = {
    id: 'messenger',
    label: 'Pigeon Messenger',
    description: 'Chat with friends',
    icon16: brandIcon('pigeon-16'),
    icon32: brandIcon('pigeon-32'),
    onOpen: openMessenger,
  }
  const explorer: Launcher = {
    id: 'explorer',
    label: 'Pigeon Explorer',
    description: 'Browse peer pages',
    icon16: tangoIcon('internet-web-browser', 16),
    icon32: tangoIcon('internet-web-browser', 32),
    onOpen: later('Pigeon Explorer', LATER.explorer),
  }
  const readme: Launcher = {
    id: 'readme',
    label: 'Read Me',
    icon16: tangoIcon('text-x-generic', 16),
    icon32: tangoIcon('text-x-generic', 32),
    onOpen: openReadme,
  }
  const addFriend: Launcher = {
    id: 'add-friend',
    label: 'Add a Friend...',
    icon16: tangoIcon('contact-new', 16),
    icon32: tangoIcon('contact-new', 32),
    onOpen: () => openAddFriend(),
  }
  const letters: Launcher = {
    id: 'letters',
    label: 'Letters',
    icon16: tangoIcon('internet-mail', 16),
    icon22: tangoIcon('internet-mail', 22),
    icon32: tangoIcon('internet-mail', 32),
    onOpen: later('Letters', LATER.letters),
  }
  const files: Launcher = {
    id: 'files',
    label: 'Shared Files',
    icon16: tangoIcon('folder', 16),
    icon22: tangoIcon('folder', 22),
    icon32: tangoIcon('folder', 32),
    onOpen: later('Shared Files', LATER.files),
  }
  const source: Launcher = {
    id: 'source',
    label: 'Source Code',
    icon16: tangoIcon('internet-web-browser', 16),
    icon22: tangoIcon('internet-web-browser', 22),
    icon32: tangoIcon('internet-web-browser', 32),
    onOpen: () => env.openLink(SOURCE_URL),
  }
  const trash: Launcher = {
    id: 'trash',
    label: 'Trash',
    icon16: tangoIcon('user-trash', 16),
    icon32: tangoIcon('user-trash', 32),
    onOpen: later('Trash', ['The Trash is empty.']),
  }
  const settings: Launcher = {
    id: 'settings',
    label: 'Settings',
    icon16: tangoIcon('preferences-system', 16),
    icon22: tangoIcon('preferences-system', 22),
    icon32: tangoIcon('preferences-system', 32),
    onOpen: api.openDisplayProperties,
  }
  const help: Launcher = {
    id: 'help',
    label: 'Help',
    icon16: tangoIcon('help-browser', 16),
    icon22: tangoIcon('help-browser', 22),
    icon32: tangoIcon('help-browser', 32),
    onOpen: openReadme,
  }
  const about: Launcher = {
    id: 'about',
    label: 'About Pigeon',
    icon16: brandIcon('pigeon-16'),
    icon32: brandIcon('pigeon-32'),
    onOpen: openAbout,
  }

  return {
    desktopIcons: [messenger, { ...readme, label: 'Read Me.txt' }, letters, files, source, trash],
    quickLaunch: [messenger, readme],
    menu: {
      programs: [messenger, explorer, readme, addFriend],
      places: [{ ...letters, label: 'My Letters' }, files, source],
      tools: [settings, help],
      all: [about, explorer, messenger, readme, settings],
    },
    openReadme,
    openMessenger,
    openConversation,
    openAddFriend,
    sample,
    messengerEvents,
  }
}
