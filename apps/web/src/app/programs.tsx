// What's on the desktop and in the menu, and what each opens. Content lives in tables here; the
// shell draws it and the apps fill the windows.
import { formatFingerprint, type Invite, type PeerId } from '@pigeon/core'
import { type Accessor, createSignal, Show } from 'solid-js'
import { About, SOURCE_URL } from '../apps/about/about/about.tsx'
import { AddFriend } from '../apps/messenger/add-friend/add-friend.tsx'
import { BuddyList } from '../apps/messenger/buddy-list/buddy-list.tsx'
import {
  BlockedPeople,
  FriendProfile,
  MuteFriend,
  RemoveFriend,
  RenameFriend,
} from '../apps/messenger/friend-dialogs/friend-dialogs.tsx'
import { LiveConversation } from '../apps/messenger/live-conversation/live-conversation.tsx'
import { SAMPLE_SELF, sampleConversation } from '../apps/messenger/sample/sample.ts'
import { SampleConversation } from '../apps/messenger/sample-conversation/sample-conversation.tsx'
import type { FriendView, Messenger, MessengerEvents } from '../apps/messenger/service/service.ts'
import { Today } from '../apps/messenger/today/today.tsx'
import { CHANGELOG_TEXT } from '../apps/reader/changelog/changelog.ts'
import { HOME_SCREEN_TEXT } from '../apps/reader/home-screen/home-screen-text.ts'
import { Reader } from '../apps/reader/reader/reader.tsx'
import { README_TEXT } from '../apps/reader/readme/readme-text.ts'
import type { ShellProps } from '../shell/shell/shell.tsx'
import type { Launcher, ShellApi, ShellEnv } from '../shell/shell/types.ts'
import { avatarIcon } from '../ui/avatar/avatar.tsx'
import { brandIcon, type Icon, tangoIcon } from '../ui/icons/icons.ts'
import type { MenuEntry } from '../ui/menu/menu.tsx'

export interface Programs extends ShellProps {
  readonly openReadme: () => void
  /** Changelog.txt, the release notes (decision 0025). */
  readonly openChangelog: () => void
  /** Add to Home Screen.txt, for iPhones in a Safari tab (decision 0026). */
  readonly openHomeScreen: () => void
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
  /** An iPhone in a Safari tab, whose storage lasts 7 days: Add to Home Screen.txt is shown. */
  needsHomeScreen = false,
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
      content: (window) => (
        <Reader name="Read Me.txt" text={README_TEXT} onClose={window.close} onAbout={openAbout} />
      ),
    })

  const openChangelog = () =>
    api.open('changelog', {
      title: 'Changelog.txt - Pigeon Reader',
      icon: tangoIcon('text-x-generic', 16),
      bounds: { x: 132, y: 40, width: 450, height: 480 },
      resizable: true,
      content: (window) => (
        <Reader
          name="Changelog.txt"
          text={CHANGELOG_TEXT}
          onClose={window.close}
          onAbout={openAbout}
        />
      ),
    })

  const openHomeScreen = () =>
    api.open('home-screen', {
      title: 'Add to Home Screen.txt - Pigeon Reader',
      icon: tangoIcon('text-x-generic', 16),
      bounds: { x: 152, y: 64, width: 450, height: 480 },
      resizable: true,
      content: (window) => (
        <Reader
          name="Add to Home Screen.txt"
          text={HOME_SCREEN_TEXT}
          onClose={window.close}
          onAbout={openAbout}
        />
      ),
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
      title: `${friend.name} - Conversation`,
      taskTitle: friend.name,
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
          actions={() => friendMenu(id, 'chat')}
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
      bounds: { x: 232, y: 90, width: 560, height: 440 },
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

  // A friend's menu and the windows it opens (docs/design.md, "Friends").
  const now = () => env.now().getTime()
  const friendDialog = (
    kind: string,
    id: PeerId,
    title: string,
    size: { width: number; height: number },
    content: (messenger: Messenger, close: () => void) => ReturnType<typeof FriendProfile>,
  ) => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    api.open(`${kind}:${id}`, {
      title,
      icon: tangoIcon('contact-new', 16),
      bounds: { x: 512 - size.width / 2, y: 384 - size.height / 2 - 40, ...size },
      controls: { minimize: false, maximize: false },
      content: (window) => content(messenger, window.close),
    })
  }
  const openRename = (id: PeerId) =>
    friendDialog('rename', id, 'Rename Friend', { width: 340, height: 190 }, (messenger, close) => (
      <RenameFriend messenger={messenger} friend={id} onClose={close} now={now} />
    ))
  const openProfile = (id: PeerId) => {
    const name = host.messenger()?.friend(id)?.name ?? 'Friend'
    friendDialog('profile', id, `${name} - Profile`, { width: 380, height: 280 }, (m, close) => (
      <FriendProfile
        messenger={m}
        friend={id}
        onClose={close}
        now={now}
        onRename={() => {
          close()
          openRename(id)
        }}
      />
    ))
  }
  const openMute = (id: PeerId) =>
    friendDialog('mute', id, 'Mute Friend', { width: 360, height: 230 }, (messenger, close) => (
      <MuteFriend messenger={messenger} friend={id} onClose={close} now={now} />
    ))
  const openRemove = (id: PeerId) =>
    friendDialog('remove', id, 'Remove Friend', { width: 400, height: 220 }, (messenger, close) => (
      <RemoveFriend
        messenger={messenger}
        friend={id}
        now={now}
        onClose={() => {
          close()
          if (messenger.friend(id) === undefined) api.close(conversationWindow(id))
        }}
      />
    ))
  const openBlocked = () => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    api.open('blocked', {
      title: 'Blocked People',
      icon: tangoIcon('contact-new', 16),
      bounds: { x: 332, y: 220, width: 360, height: 280 },
      controls: { minimize: false, maximize: false },
      content: (window) => <BlockedPeople messenger={messenger} onClose={window.close} />,
    })
  }
  const copyFingerprint = async (id: PeerId) => {
    const view = host.messenger()?.friend(id)
    if (view === undefined) return
    const copied = await host.copyText(formatFingerprint(view.fingerprint))
    api.notify({
      title: copied ? 'Fingerprint copied' : 'Copy the fingerprint',
      icon: tangoIcon('contact-new', 16),
      body: copied
        ? `${view.name}'s fingerprint is on the clipboard.`
        : `Your browser kept the clipboard to itself. It's in ${view.name}'s profile.`,
    })
  }
  /**
   * A friend's menu. In the list it starts with Send a Message and Buzz!; a chat window's
   * Actions menu has its own Buzz, so it starts at View Profile.
   */
  const friendMenu = (contactId: string, place: 'list' | 'chat' = 'list'): readonly MenuEntry[] => {
    const messenger = host.messenger()
    const view = messenger?.friend(contactId as PeerId)
    if (messenger === undefined || view === undefined) return []
    const id = view.id
    if (view.removedYouAt !== undefined)
      return [
        ...(place === 'list'
          ? [{ label: 'Open &Chat', onSelect: () => openFriendConversation(id) }]
          : []),
        { label: 'View &Profile', onSelect: () => openProfile(id) },
        { kind: 'separator' },
        { label: 'Re&move Friend...', onSelect: () => openRemove(id) },
      ]
    const about: readonly MenuEntry[] = [
      { label: 'View &Profile', onSelect: () => openProfile(id) },
      { label: '&Rename...', onSelect: () => openRename(id) },
      { label: 'Copy &Fingerprint', onSelect: () => void copyFingerprint(id) },
      { kind: 'separator' },
      messenger.muted(id)
        ? { label: 'Un&mute', onSelect: () => void messenger.mute(id, undefined) }
        : { label: '&Mute...', onSelect: () => openMute(id) },
      { kind: 'separator' },
      { label: 'Re&move Friend...', onSelect: () => openRemove(id) },
    ]
    if (place === 'chat') return about
    return [
      { label: 'Send a &Message', onSelect: () => openFriendConversation(id) },
      {
        label: '&Buzz!',
        disabled: !view.online,
        onSelect: () => {
          openFriendConversation(id)
          messenger.buzz(id)
          api.buzz(conversationWindow(id))
        },
      },
      { kind: 'separator' },
      ...about,
    ]
  }

  const friendIcon = brandIcon('pigeon-16')
  const muted = (friend: FriendView) => host.messenger()?.muted(friend.id) === true
  const messengerEvents: MessengerEvents = {
    // Someone answered your invite: their chat opens, starting with "... became friends".
    onPaired: (friend: FriendView) => {
      setSample(false)
      openFriendConversation(friend.id)
    },
    // Their own bird says who it is before the name does.
    onOnline: (friend) => {
      if (muted(friend)) return
      const messenger = host.messenger()
      const notify = (icon: Icon) =>
        api.notify({ title: friend.name, icon, body: 'has just come online.' })
      if (messenger === undefined) return notify(friendIcon)
      void messenger.avatarOf(friend.id).then(
        (traits) => notify(avatarIcon(traits)),
        () => notify(friendIcon),
      )
    },
    onUnfriended: (friend) =>
      api.notify({
        title: `${friend.name} removed you`,
        icon: friendIcon,
        body: 'Your chat stays until you remove them too.',
      }),
    onMessage: (friend, entry) => {
      if (muted(friend) || api.isActive(conversationWindow(friend.id))) return
      api.notify({
        title: `${friend.name} says:`,
        icon: friendIcon,
        body: entry.text.slice(0, 120),
      })
    },
    onBuzz: (friend) => {
      // Muted: the buzz is in the chat, but nothing shakes or vibrates.
      if (muted(friend)) return
      if (!sample()) openFriendConversation(friend.id)
      api.buzz(conversationWindow(friend.id))
    },
  }

  // File, Always Go Through the Relay (decision 0026): friends never see your address.
  const setRelayOnly = async (on: boolean) => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    await messenger.setRelayOnly(on)
    api.notify({
      title: on ? 'Going through the relay' : 'Connecting directly',
      icon: tangoIcon('network-transmit-receive', 16),
      body: on
        ? 'Friends no longer see your address. Connections are slower, and need the relay to be reachable.'
        : 'Pigeon connects straight to friends where it can, which is faster. They can see your address.',
    })
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
          menuFor={friendMenu}
          onBlockedPeople={openBlocked}
          onRelayOnly={(on) => void setRelayOnly(on)}
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
  const changelog: Launcher = {
    id: 'changelog',
    label: "What's New",
    icon16: tangoIcon('text-x-generic', 16),
    icon22: tangoIcon('text-x-generic', 22),
    icon32: tangoIcon('text-x-generic', 32),
    onOpen: openChangelog,
  }
  const homeScreen: Launcher = {
    id: 'home-screen',
    label: 'Add to Home Screen.txt',
    icon16: tangoIcon('text-x-generic', 16),
    icon22: tangoIcon('text-x-generic', 22),
    icon32: tangoIcon('text-x-generic', 32),
    onOpen: openHomeScreen,
  }
  const iphone = needsHomeScreen ? [homeScreen] : []
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

  /** The windows the Messenger key stands for on the phone. */
  const messengerWindow = (id: string) =>
    id === 'messenger' ||
    id === 'add-friend' ||
    id.startsWith('conversation:') ||
    id.startsWith('sample:')

  return {
    phone: {
      home: () => (
        <Today
          messenger={host.messenger()}
          problem={host.problem()}
          now={env.now}
          onOpenMessenger={openMessenger}
          onOpenConversation={(id) => {
            setSample(false)
            openFriendConversation(id)
          }}
          onAddFriend={() => openAddFriend()}
        />
      ),
      news: () => {
        const unread =
          host
            .messenger()
            ?.friends()
            .filter((friend) => friend.unread > 0) ?? []
        const first = unread[0]
        if (first === undefined) return undefined
        if (unread.length > 1) {
          const total = unread.reduce((sum, friend) => sum + friend.unread, 0)
          return `${total} new messages`
        }
        return `${first.unread} new from ${first.name}`
      },
      // The left soft key does the obvious next thing for what's on screen.
      leftSoftKey: (front) => {
        if (front === 'messenger') return { label: 'Add Friend', onPress: () => openAddFriend() }
        if (front !== undefined && messengerWindow(front))
          return { label: 'Friends', onPress: openMessenger }
        return { label: 'Messenger', onPress: openMessenger }
      },
    },
    connection: {
      relayOnly: () => host.messenger()?.settings().relayOnly,
      setRelayOnly: (on) => void setRelayOnly(on),
    },
    desktopIcons: [
      messenger,
      { ...readme, label: 'Read Me.txt' },
      { ...changelog, label: 'Changelog.txt' },
      ...iphone,
      letters,
      files,
      source,
      trash,
    ],
    quickLaunch: [messenger, readme],
    menu: {
      programs: [messenger, explorer, readme, addFriend],
      places: [{ ...letters, label: 'My Letters' }, files, source],
      tools: [settings, help, changelog, ...iphone],
      all: [about, explorer, messenger, readme, settings, changelog],
    },
    openReadme,
    openChangelog,
    openHomeScreen,
    openMessenger,
    openConversation,
    openAddFriend,
    sample,
    messengerEvents,
  }
}
