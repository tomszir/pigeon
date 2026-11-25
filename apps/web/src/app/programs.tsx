// What's on the desktop and in the menu, and what each opens. Content lives in tables here; the
// shell draws it and the apps fill the windows.
import {
  decodeRecoveryCode,
  encodeRecoveryCode,
  formatFingerprint,
  type Invite,
  type PeerId,
} from '@pigeon/core'
import { type Accessor, createEffect, createSignal, on, Show } from 'solid-js'
import { About, SOURCE_URL } from '../apps/about/about/about.tsx'
import { HOME_ADDRESS } from '../apps/explorer/explorer/address.ts'
import { Explorer } from '../apps/explorer/explorer/explorer.tsx'
import { localPageFinder, START_PAGES } from '../apps/explorer/local-pages/local-pages.ts'
import type { KeptView } from '../apps/explorer/page-frame/view.ts'
import { HELP_HOME, HELP_PAGES } from '../apps/help/help-pages/help-pages.ts'
import { AddFriend } from '../apps/messenger/add-friend/add-friend.tsx'
import { BuddyList } from '../apps/messenger/buddy-list/buddy-list.tsx'
import { JoinDevice, LinkDevice, MyDevices } from '../apps/messenger/devices/devices.tsx'
import {
  BlockedPeople,
  FriendProfile,
  MuteFriend,
  RemoveFriend,
  RenameFriend,
} from '../apps/messenger/friend-dialogs/friend-dialogs.tsx'
import { LiveConversation } from '../apps/messenger/live-conversation/live-conversation.tsx'
import {
  MakeRecoveryKey,
  type RecoveryKit,
  UseRecoveryKey,
} from '../apps/messenger/recovery/recovery.tsx'
import { SAMPLE_SELF, sampleConversation } from '../apps/messenger/sample/sample.ts'
import { SampleConversation } from '../apps/messenger/sample-conversation/sample-conversation.tsx'
import type { FriendView, Messenger, MessengerEvents } from '../apps/messenger/service/service.ts'
import { Today } from '../apps/messenger/today/today.tsx'
import {
  ExportData,
  ImportData,
  type PassphraseSeal,
} from '../apps/messenger/your-data/your-data.tsx'
import { Network } from '../apps/network/network/network.tsx'
import { CHANGELOG_TEXT } from '../apps/reader/changelog/changelog.ts'
import { HOME_SCREEN_TEXT } from '../apps/reader/home-screen/home-screen-text.ts'
import { Reader } from '../apps/reader/reader/reader.tsx'
import { README_TEXT } from '../apps/reader/readme/readme-text.ts'
import { createBrowserCrypto } from '../platform/crypto/browser-crypto.ts'
import { openWithPassphrase, sealWithPassphrase } from '../platform/crypto/passphrase.ts'
import { generateRecoveryKey, recoverySigner } from '../platform/crypto/recovery-key.ts'
import { browserFiles } from '../platform/files/browser-files.ts'
import type { ShellProps } from '../shell/shell/shell.tsx'
import type { Launcher, ShellApi, ShellEnv } from '../shell/shell/types.ts'
import { avatarIcon } from '../ui/avatar/avatar.tsx'
import { brandIcon, type Icon, tangoIcon } from '../ui/icons/icons.ts'
import type { MenuEntry } from '../ui/menu/menu.tsx'
import { OFFICIAL_LIGHTHOUSES } from './official-lighthouses.ts'

export interface Programs extends ShellProps {
  readonly openReadme: () => void
  /** Changelog.txt, the release notes. */
  readonly openChangelog: () => void
  /** Add to Home Screen.txt, for iPhones in a Safari tab. */
  readonly openHomeScreen: () => void
  readonly openMessenger: () => void
  readonly openConversation: (contactId: string) => void
  readonly openAddFriend: (incoming?: Invite) => void
  /** Link to My Other Device, perhaps from a link in the address bar. */
  readonly openJoinDevice: (incoming?: Invite) => void
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
  /** Starts Pigeon again, as a newly linked device must to become its identity. */
  readonly restart: () => void
  /**
   * Forgets everything here and starts again at Link to My Other Device, linking to
   * `target` straight away when it's given, as leaving a Pigeon does.
   */
  readonly startOver: (target?: Invite) => Promise<void>
}

/** Programs not built yet say so, in the world's own voice. */
const LATER = {
  letters: ['Letters is still being built.', 'Sealed letters carried by friends arrive soon.'],
  files: ['Shared Files is still being built.', 'Sending files to friends arrives soon.'],
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
          saveText={browserFiles.saveText}
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

  // Your devices.
  const deviceIcon = tangoIcon('network-transmit-receive', 16)
  const openLinkDevice = () => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    api.open('link-device', {
      title: 'Link a Device',
      icon: deviceIcon,
      bounds: { x: 232, y: 110, width: 520, height: 330 },
      controls: { maximize: false },
      content: (window) => <LinkDevice messenger={messenger} onClose={window.close} />,
    })
  }
  const openJoinDevice = (incoming?: Invite) => {
    if (incoming !== undefined) api.close('join-device')
    api.open('join-device', {
      title: 'Link to My Other Device',
      icon: deviceIcon,
      // Tall enough for leaving's progress, Don't Wait and all.
      bounds: { x: 252, y: 110, width: 480, height: 400 },
      controls: { maximize: false },
      content: (window) => (
        <Show
          when={host.messenger()}
          fallback={<p>{host.problem() ?? 'Pigeon is still starting...'}</p>}
        >
          {(messenger) => (
            <JoinDevice
              messenger={messenger()}
              incoming={incoming}
              sleep={host.sleep}
              onLinked={host.restart}
              onLeave={(left, target) => {
                // Pigeon moved to another tab meanwhile: that tab's store isn't ours to clear.
                if (host.messenger() === left) void host.startOver(target)
              }}
              onClose={window.close}
            />
          )}
        </Show>
      ),
    })
  }
  const openMyDevices = () => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    api.open('my-devices', {
      title: 'My Devices',
      icon: deviceIcon,
      bounds: { x: 312, y: 150, width: 400, height: 320 },
      controls: { maximize: false },
      content: (window) => (
        <MyDevices
          messenger={messenger}
          onLinkDevice={openLinkDevice}
          onStartOver={() => void host.startOver()}
          onClose={window.close}
        />
      ),
    })
  }

  // Your data in a file, sealed with a passphrase.
  const passphraseSeal: PassphraseSeal = { seal: sealWithPassphrase, open: openWithPassphrase }
  const dataIcon = tangoIcon('folder', 16)
  const openExportData = () => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    api.open('export-data', {
      title: 'Export My Data',
      icon: dataIcon,
      bounds: { x: 292, y: 140, width: 440, height: 300 },
      controls: { maximize: false },
      content: (window) => (
        <ExportData
          messenger={messenger}
          files={browserFiles}
          seal={passphraseSeal}
          now={Date.now}
          onClose={window.close}
        />
      ),
    })
  }
  const openImportData = () => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    api.open('import-data', {
      title: 'Import My Data',
      icon: dataIcon,
      bounds: { x: 302, y: 150, width: 440, height: 280 },
      controls: { maximize: false },
      content: (window) => (
        <ImportData
          messenger={messenger}
          files={browserFiles}
          seal={passphraseSeal}
          onImported={host.restart}
          onClose={window.close}
        />
      ),
    })
  }

  // The recovery key.
  const recoveryCrypto = createBrowserCrypto()
  const recoveryKit: RecoveryKit = {
    generate: () => generateRecoveryKey(),
    signer: (seed) => recoverySigner(seed),
    encode: (code) => encodeRecoveryCode(recoveryCrypto, code),
    decode: (text) => decodeRecoveryCode(recoveryCrypto, text),
    files: browserFiles,
    seal: passphraseSeal,
  }
  const keyIcon = tangoIcon('preferences-system', 16)
  const openMakeRecoveryKey = () => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    api.open('make-recovery-key', {
      title: 'Make a Recovery Key',
      icon: keyIcon,
      bounds: { x: 272, y: 100, width: 480, height: 420 },
      controls: { maximize: false },
      content: (window) => (
        <MakeRecoveryKey messenger={messenger} kit={recoveryKit} onClose={window.close} />
      ),
    })
  }
  const openUseRecoveryKey = (mode: 'recover' | 'use') => {
    const messenger = host.messenger()
    if (messenger === undefined) return
    api.open('use-recovery-key', {
      title: mode === 'recover' ? 'Recover My Pigeon' : 'Use My Recovery Key',
      icon: keyIcon,
      bounds: { x: 282, y: 110, width: 480, height: 440 },
      controls: { maximize: false },
      content: (window) => (
        <UseRecoveryKey
          messenger={messenger}
          kit={recoveryKit}
          mode={mode}
          onRecovered={host.restart}
          onClose={window.close}
        />
      ),
    })
  }
  // Right after a new Pigeon gets its name, the key is offered once; "Later" is fine, and a
  // balloon on a later visit reminds you, once.
  createEffect(
    on(
      () => {
        const running = host.messenger()
        return running === undefined ? undefined : ([running, running.profile().handle] as const)
      },
      (now, before) => {
        if (now === undefined) return
        const [running, handle] = now
        const offerable =
          handle !== '' &&
          running.recoveryKey() === undefined &&
          running.isFirstDevice() &&
          running.nextEpoch() === 1
        if (!offerable) return
        if (before !== undefined && before[0] === running && before[1] === '') {
          // Named while answering an invite: a balloon, so pairing isn't covered up.
          if (!api.isOpen('add-friend')) openMakeRecoveryKey()
          else
            api.notify({
              title: 'Make a recovery key',
              icon: tangoIcon('dialog-information', 16),
              body: 'If you lose every device, a recovery key brings your Pigeon back. Make one now?',
              onClick: openMakeRecoveryKey,
            })
          return
        }
        if (before === undefined)
          void running.remindRecoveryOnce().then((remind) => {
            if (!remind) return
            api.notify({
              title: 'Make a recovery key',
              icon: tangoIcon('dialog-information', 16),
              body: 'If you lose every device, a recovery key brings your Pigeon back. Make one now?',
              onClick: openMakeRecoveryKey,
            })
          })
      },
    ),
  )

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
  // A balloon about a friend carries their own bird, which says who it is before the name does.
  // Each friend's is worked out once, so later balloons show at once and stay in order.
  const birds = new Map<PeerId, Icon>()
  const notifyFrom = (friend: FriendView, notice: { title: string; body: string }) => {
    const known = birds.get(friend.id)
    if (known !== undefined) return api.notify({ ...notice, icon: known })
    const messenger = host.messenger()
    if (messenger === undefined) return api.notify({ ...notice, icon: friendIcon })
    void messenger.avatarOf(friend.id).then(
      (traits) => {
        const icon = avatarIcon(traits)
        birds.set(friend.id, icon)
        api.notify({ ...notice, icon })
      },
      () => api.notify({ ...notice, icon: friendIcon }),
    )
  }
  const muted = (friend: FriendView) => host.messenger()?.muted(friend.id) === true
  const messengerEvents: MessengerEvents = {
    // Someone answered your invite: their chat opens, starting with "... became friends".
    onPaired: (friend: FriendView) => {
      setSample(false)
      openFriendConversation(friend.id)
    },
    onOnline: (friend) => {
      if (muted(friend)) return
      notifyFrom(friend, { title: friend.name, body: 'has just come online.' })
    },
    onDeviceRemoved: () =>
      api.notify({
        title: 'This device was removed',
        icon: tangoIcon('dialog-warning', 16),
        body: 'Another of your devices took this one off your Pigeon. It keeps its chats, but talks to nobody now.',
      }),
    onTwin: () =>
      api.notify({
        title: 'This Pigeon is also open somewhere else',
        icon: tangoIcon('dialog-warning', 16),
        body: 'Another browser has this device’s key, as a copied browser profile would. See My Devices to make this one a new device.',
        onClick: openMyDevices,
      }),
    onUnfriended: (friend) =>
      notifyFrom(friend, {
        title: `${friend.name} removed you`,
        body: 'Your chat stays until you remove them too.',
      }),
    onMessage: (friend, entry) => {
      if (muted(friend) || api.isActive(conversationWindow(friend.id))) return
      notifyFrom(friend, { title: `${friend.name} says:`, body: entry.text.slice(0, 120) })
    },
    onBuzz: (friend) => {
      // Muted: the buzz is in the chat, but nothing shakes or vibrates.
      if (muted(friend)) return
      if (!sample()) openFriendConversation(friend.id)
      api.buzz(conversationWindow(friend.id))
    },
  }

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
          onMyDevices={openMyDevices}
          onLinkDevice={openLinkDevice}
          onJoinDevice={() => openJoinDevice()}
          onMakeRecoveryKey={openMakeRecoveryKey}
          onUseRecoveryKey={() => openUseRecoveryKey('use')}
          onRecoverPigeon={() => openUseRecoveryKey('recover')}
          onExportData={openExportData}
          onImportData={openImportData}
          onRelayOnly={(on) => void setRelayOnly(on)}
          onAbout={openAbout}
          onClose={window.close}
        />
      ),
    })

  /** Every page that comes with Pigeon: the start page, then Help. */
  const findPage = localPageFinder(START_PAGES, HELP_PAGES)
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

  /** The windows the Messenger key stands for on the phone. */
  const messengerWindow = (id: string) =>
    id === 'messenger' ||
    id === 'add-friend' ||
    id === 'link-device' ||
    id === 'join-device' ||
    id === 'my-devices' ||
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
    sample,
    messengerEvents,
  }
}
