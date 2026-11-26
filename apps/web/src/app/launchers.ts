// The desktop's and the menu's tables of programs: each Launcher with its icons and what it
// opens, which of them sit on the desktop, in the Pigeon menu and on the Pocket's home screen.
// Only programs.tsx imports this; it hands in the openers.

import type { Accessor } from 'solid-js'
import { SOURCE_URL } from '../apps/about/about/about.tsx'
import { HELP_HOME } from '../apps/help/help-pages/help-pages.ts'
import type { AddFriendTab, IncomingInvite } from '../apps/messenger/add-friend/add-friend.tsx'
import type { Messenger } from '../apps/messenger/service/service.ts'
import type { HomeApp } from '../apps/messenger/today/today.tsx'
import type { Launcher, ShellApi, ShellEnv } from '../shell/shell/types.ts'
import { brandIcon, tangoIcon } from '../ui/icons/icons.ts'

/** Programs not built yet say so, in the world's own voice. */
const LATER = {
  letters: [
    'Letters, a window of everything carried by letter, is still being built.',
    "Messages to friends who are offline already go by letter: they're in your chats.",
  ],
  files: ['Shared Files is still being built.', 'Sending files to friends arrives soon.'],
} as const

/** What the launchers open, from programs.tsx. */
export interface LauncherOpeners {
  readonly openMessenger: () => void
  readonly openAddFriend: (incoming?: IncomingInvite, tab?: AddFriendTab) => void
  readonly openAbout: () => void
  readonly openReadme: () => void
  readonly openChangelog: () => void
  readonly openHomeScreen: () => void
  readonly openNetwork: () => void
  /** Pigeon Explorer, at its start page or at `start`. */
  readonly openExplorer: (start?: string) => void
}

/** Where the launchers sit: on the desktop, in the Pigeon menu and on the Pocket's home screen. */
export interface Launchers {
  readonly desktopIcons: readonly Launcher[]
  readonly quickLaunch: readonly Launcher[]
  readonly menu: {
    readonly programs: readonly Launcher[]
    readonly places: readonly Launcher[]
    readonly tools: readonly Launcher[]
    readonly all: readonly Launcher[]
  }
  readonly homeApps: readonly HomeApp[]
}

export function createLaunchers(
  api: ShellApi,
  env: ShellEnv,
  /** The running Messenger, for the counts on the Pocket's home screen. */
  running: Accessor<Messenger | undefined>,
  /** An iPhone in a Safari tab, whose storage lasts 7 days: Add to Home Screen.txt is shown. */
  needsHomeScreen: boolean,
  {
    openMessenger,
    openAddFriend,
    openAbout,
    openReadme,
    openChangelog,
    openHomeScreen,
    openNetwork,
    openExplorer,
  }: LauncherOpeners,
): Launchers {
  const later = (title: string, text: readonly string[]) => () =>
    api.message({ title, kind: 'information', text })

  const messenger: Launcher = {
    id: 'messenger',
    label: 'Pigeon Messenger',
    description: 'Chat with friends',
    icon16: brandIcon('messenger-16'),
    icon22: brandIcon('messenger-22'),
    icon32: brandIcon('messenger-32'),
    onOpen: openMessenger,
  }
  const explorer: Launcher = {
    id: 'explorer',
    label: 'Pigeon Explorer',
    description: 'Browse peer pages',
    icon16: tangoIcon('internet-web-browser', 16),
    icon32: tangoIcon('internet-web-browser', 32),
    onOpen: () => openExplorer(),
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
  const network: Launcher = {
    id: 'network',
    label: 'Network',
    description: 'Lighthouses and connection',
    icon16: tangoIcon('network-workgroup', 16),
    icon22: tangoIcon('network-workgroup', 22),
    icon32: tangoIcon('network-workgroup', 32),
    onOpen: () => openNetwork(),
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
    onOpen: () => openExplorer(HELP_HOME),
  }
  const about: Launcher = {
    id: 'about',
    label: 'About Pigeon',
    icon16: brandIcon('pigeon-16'),
    icon32: brandIcon('pigeon-32'),
    onOpen: openAbout,
  }

  // The Pocket's home screen: these programs, with what waits in each.
  const unreadCount = () =>
    running()
      ?.friends()
      .reduce((sum, friend) => sum + friend.unread, 0) ?? 0
  const requestCount = () =>
    running()
      ?.inviteLinks()
      .reduce(
        (sum, link) => sum + link.requests.filter((request) => request.state === 'waiting').length,
        0,
      ) ?? 0
  const homeApps: readonly HomeApp[] = [
    {
      id: 'messenger',
      label: 'Messenger',
      icon: messenger.icon32,
      onOpen: openMessenger,
      badge: unreadCount,
    },
    { id: 'explorer', label: 'Explorer', icon: explorer.icon32, onOpen: explorer.onOpen },
    {
      id: 'add-friend',
      label: 'Add Friend',
      icon: addFriend.icon32,
      onOpen: () => openAddFriend(undefined, requestCount() > 0 ? 'links' : undefined),
      badge: requestCount,
    },
    { id: 'network', label: 'Network', icon: network.icon32, onOpen: network.onOpen },
    { id: 'readme', label: 'Read Me', icon: readme.icon32, onOpen: readme.onOpen },
    { id: 'help', label: 'Help', icon: help.icon32, onOpen: help.onOpen },
    { id: 'settings', label: 'Settings', icon: settings.icon32, onOpen: settings.onOpen },
    { id: 'letters', label: 'Letters', icon: letters.icon32, onOpen: letters.onOpen },
  ]
  return {
    desktopIcons: [
      messenger,
      network,
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
      tools: [network, settings, help, changelog, ...iphone],
      all: [about, explorer, messenger, network, readme, settings, changelog],
    },
    homeApps,
  }
}
