// What's on the desktop and in the menu, and what each opens: this file assembles the openers, the
// tables of programs are in launchers.ts, the shell draws it and the apps fill the windows.

import type { Invite } from '@pigeon/core'
import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { About } from '../apps/about/about/about.tsx'
import { HOME_ADDRESS } from '../apps/explorer/explorer/address.ts'
import { Explorer } from '../apps/explorer/explorer/explorer.tsx'
import { localPageFinder } from '../apps/explorer/local-pages/local-pages.ts'
import type { KeptView } from '../apps/explorer/page-frame/view.ts'
import { HELP_HOME } from '../apps/help/help-pages/help-pages.ts'
import type { AddFriendTab, IncomingInvite } from '../apps/messenger/add-friend/add-friend.tsx'
import {
  createNotifications,
  NotificationFlyout,
} from '../apps/messenger/notifications/notifications.tsx'
import type { FriendView, MessengerEvents } from '../apps/messenger/service/messenger.ts'
import { Today } from '../apps/messenger/today/today.tsx'
import { Network } from '../apps/network/network/network.tsx'
import { CHANGELOG_TEXT } from '../apps/reader/changelog/changelog.ts'
import { HOME_SCREEN_TEXT } from '../apps/reader/home-screen/home-screen-text.ts'
import { Reader } from '../apps/reader/reader/reader.tsx'
import { README_TEXT } from '../apps/reader/readme/readme-text.ts'
import type { ShellProps } from '../shell/shell/shell.tsx'
import type { ShellApi, ShellEnv, TraySpec } from '../shell/shell/types.ts'
import { avatarIcon } from '../ui/avatar/avatar.tsx'
import { brandIcon, type Icon, tangoIcon } from '../ui/icons/icons.ts'
import { BUNDLED_PAGES } from './bundled-pages.ts'
import { createLaunchers } from './launchers.ts'
import { createMessageBalloons, remindAboutRecoveryKey } from './message-balloons.ts'
import type { MessengerHost } from './messenger-host.ts'
import { createMessengerWindows } from './messenger-windows.tsx'
import { OFFICIAL_LIGHTHOUSES } from './official-lighthouses.ts'

export interface Programs extends ShellProps {
  readonly openReadme: () => void
  /** Changelog.txt, the release notes. */
  readonly openChangelog: () => void
  /** Add to Home Screen.txt, for iPhones in a Safari tab. */
  readonly openHomeScreen: () => void
  readonly openMessenger: () => void
  readonly openConversation: (contactId: string) => void
  readonly openAddFriend: (incoming?: IncomingInvite, tab?: AddFriendTab) => void
  /**
   * Link to My Other Device, perhaps from a link in the address bar. `confirmed` when you
   * already chose to link to it here, so it goes ahead without asking again.
   */
  readonly openJoinDevice: (incoming?: Invite, confirmed?: boolean) => void
  /** What the Messenger tells the desktop: balloons, buzzes, new friends. */
  readonly messengerEvents: MessengerEvents
}

export function createPrograms(
  api: ShellApi,
  env: ShellEnv,
  host: MessengerHost,
  /** An iPhone in a Safari tab, whose storage lasts 7 days: Add to Home Screen.txt is shown. */
  needsHomeScreen = false,
): Programs {
  // Your own pixel pigeon, for the Pigeon menu's header, once the Messenger is up.
  const [selfPicture, setSelfPicture] = createSignal<Icon | undefined>()
  createEffect(() => {
    const running = host.messenger()
    if (running === undefined) return
    void running.avatarOf(running.self).then((traits) => setSelfPicture(avatarIcon(traits, 32)))
  })

  // Network: where friends leave your mail, and how this Pigeon connects.
  const openNetwork = () =>
    api.open('network', {
      title: 'Network',
      icon: tangoIcon('network-workgroup', 16),
      bounds: { x: 272, y: 40, width: 500, height: 640 },
      resizable: true,
      controls: { maximize: false },
      content: (window) => (
        <Network
          messenger={host.messenger()}
          official={OFFICIAL_LIGHTHOUSES}
          relayOnly={host.messenger()?.settings().relayOnly}
          onRelayOnly={(on) => void setRelayOnly(on)}
          hearAtOnce={
            host.messenger() === undefined
              ? undefined
              : host.messenger()?.settings().hearAtOnce !== false
          }
          onHearAtOnce={(on) => void host.messenger()?.setHearAtOnce(on)}
          onClose={window.close}
        />
      ),
    })

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

  // File, Always Go Through the Relay: friends never see your address.
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

  const {
    openMessenger,
    openConversation,
    openFriendConversation,
    openAddFriend,
    openJoinDevice,
    openMyDevices,
    openMakeRecoveryKey,
    conversationWindow,
  } = createMessengerWindows(api, env, host, { openAbout, setRelayOnly })
  remindAboutRecoveryKey(api, host.messenger, openMakeRecoveryKey)

  const balloons = createMessageBalloons({
    api,
    messenger: host.messenger,
    now: Date.now,
    schedule: (run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    openFriendConversation,
    openMessenger,
  })
  onCleanup(balloons.dispose)
  const muted = (friend: FriendView) => host.messenger()?.muted(friend.id) === true
  const messengerEvents: MessengerEvents = {
    // Someone answered your invite: their chat opens, starting with "... became friends".
    onPaired: (friend: FriendView) => openFriendConversation(friend.id),
    // Someone asks through your code: they wait for Add, which is in Add a Friend.
    onCodeAsk: (ask) => {
      if (api.isActive('add-friend')) return
      api.notify({
        title: `${ask.handle} asks to be friends`,
        icon: brandIcon('pigeon-16'),
        body: 'They used your code. Check their fingerprint, then add them.',
        onClick: () => openAddFriend(undefined, 'code'),
      })
    },
    // Coming online is on Today and in the buddy list: a balloon each time would be noise.
    onDeviceRemoved: () =>
      api.notify({
        title: 'This device was removed',
        icon: tangoIcon('dialog-warning', 16),
        body: 'Another of your devices took this one off your Pigeon. It keeps its chats, but talks to nobody now.',
      }),
    onFriendsSetAside: (count) =>
      api.notify({
        title:
          count === 1 ? 'A friend could not be loaded' : `${count} friends could not be loaded`,
        icon: tangoIcon('dialog-warning', 16),
        body: 'Their saved records could not be read. They are kept as they were stored and not changed, and everyone else loaded.',
      }),
    onBlockedSetAside: (count) =>
      api.notify({
        title:
          count === 1
            ? 'A blocked person could not be loaded'
            : `${count} blocked people could not be loaded`,
        icon: tangoIcon('dialog-warning', 16),
        body: 'Their saved records could not be read. They are kept as they were stored and not changed, and everyone else on your blocked list loaded.',
      }),
    onFarewellsSetAside: (count) =>
      api.notify({
        title:
          count === 1 ? 'A farewell could not be loaded' : `${count} farewells could not be loaded`,
        icon: tangoIcon('dialog-warning', 16),
        body: 'Saved goodbyes to friends you removed could not be read, so those friends may not be told. They are kept as they were stored and not changed, and every other farewell loaded.',
      }),
    onTwin: () =>
      api.notify({
        title: 'This Pigeon is also open somewhere else',
        icon: tangoIcon('dialog-warning', 16),
        body: 'Another browser has this device’s key, as a copied browser profile would. See My Devices to make this one a new device.',
        onClick: openMyDevices,
      }),
    onUnfriended: (friend) =>
      balloons.notifyFrom(friend, {
        title: `${friend.name} removed you`,
        body: 'Your chat stays until you remove them too.',
      }),
    onMessage: (friend, entry) => {
      if (muted(friend) || api.isActive(conversationWindow(friend.id))) return
      balloons.hold(friend, entry.text.slice(0, 120))
    },
    onBuzz: (friend) => {
      // Muted: the buzz is in the chat, but nothing shakes or vibrates.
      if (muted(friend)) return
      openFriendConversation(friend.id)
      api.buzz(conversationWindow(friend.id))
    },
  }

  /** Every page that comes with Pigeon: the start page, then Help. */
  const findPage = localPageFinder(...BUNDLED_PAGES)
  const favorites = [
    { label: 'Pigeon &Home', address: HOME_ADDRESS },
    { label: 'Pigeon &Help', address: HELP_HOME },
  ]

  /** The view you last chose in Explorer, kept while Pigeon is open. */
  const [explorerView, setExplorerView] = createSignal<KeptView | undefined>()

  /** Pigeon Explorer, at its start page or at `start`. */
  const openExplorer = (start?: string) =>
    api.open('explorer', {
      title: 'Pigeon Explorer',
      icon: tangoIcon('internet-web-browser', 16),
      bounds: { x: 72, y: 24, width: 720, height: 560 },
      resizable: true,
      content: (window) => (
        <Explorer
          start={start}
          findPage={findPage}
          favorites={favorites}
          view={explorerView()}
          onViewChange={setExplorerView}
          copyText={host.copyText}
          onClose={window.close}
          onAbout={openAbout}
        />
      ),
    })
  const launchers = createLaunchers(api, env, host.messenger, needsHomeScreen, {
    openMessenger,
    openAddFriend,
    openAbout,
    openReadme,
    openChangelog,
    openHomeScreen,
    openNetwork,
    openExplorer,
  })

  // The time, ticking, for lists that say when things happened.
  const [clock, setClock] = createSignal(env.now())
  const ticking = setInterval(() => setClock(env.now()), 30_000)
  onCleanup(() => clearInterval(ticking))
  /** What happened while you were away: Today's list, and the tray's on the desktop. */
  const notifications = createNotifications(host.messenger, () => clock().getTime())

  /** Pigeon's icon in the desktop's tray: the same list as Today, in a flyout. */
  const tray: TraySpec = {
    count: notifications.count,
    label: () => {
      const n = notifications.count()
      return n === 0 ? 'Pigeon: nothing new' : `Pigeon: ${n} new`
    },
    flyout: (close) => (
      <Show when={host.messenger()} keyed>
        {(messenger) => (
          <NotificationFlyout
            notifications={notifications}
            messenger={messenger}
            now={clock().getTime()}
            onOpenConversation={openFriendConversation}
            onOpenRequests={() => openAddFriend(undefined, 'links')}
            onClose={close}
          />
        )}
      </Show>
    ),
  }

  /** The windows the Messenger key stands for on the phone. */
  const messengerWindow = (id: string) =>
    id === 'messenger' ||
    id === 'add-friend' ||
    id === 'link-device' ||
    id === 'join-device' ||
    id === 'my-devices' ||
    id.startsWith('conversation:')

  return {
    phone: {
      home: () => (
        <Today
          messenger={host.messenger()}
          problem={host.problem()}
          time={clock}
          notifications={notifications}
          apps={launchers.homeApps}
          onOpenMessenger={openMessenger}
          onOpenConversation={openFriendConversation}
          onOpenRequests={() => openAddFriend(undefined, 'links')}
          onAddFriend={(tab) => openAddFriend(undefined, tab)}
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
    desktopIcons: launchers.desktopIcons,
    quickLaunch: launchers.quickLaunch,
    tray,
    menu: {
      ...launchers.menu,
      user: () => {
        const name = host.messenger()?.profile().handle ?? ''
        return { name, picture: name === '' ? undefined : selfPicture() }
      },
    },
    openReadme,
    openChangelog,
    openHomeScreen,
    openMessenger,
    openConversation,
    openAddFriend,
    openJoinDevice,
    messengerEvents,
  }
}
