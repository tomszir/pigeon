// The Messenger's windows and what opens them: the buddy list, a conversation, Add a Friend, the
// device and data windows, the recovery key, and a friend's menu with the dialogs it opens. Only
// programs.tsx imports this; it hands in the shell, the host and the openers it doesn't own.

import {
  decodeRecoveryCode,
  encodeRecoveryCode,
  formatFingerprint,
  type Invite,
  type PeerId,
} from '@pigeon/core'
import { Show } from 'solid-js'
import {
  AddFriend,
  type AddFriendTab,
  type IncomingInvite,
} from '../apps/messenger/add-friend/add-friend.tsx'
import { BuddyList } from '../apps/messenger/buddy-list/buddy-list.tsx'
import {
  BlockedPeople,
  FriendProfile,
  MuteFriend,
  RemoveFriend,
  RenameFriend,
} from '../apps/messenger/friend-dialogs/friend-dialogs.tsx'
import { JoinDevice } from '../apps/messenger/join-device/join-device.tsx'
import { LinkDevice } from '../apps/messenger/link-device/link-device.tsx'
import { LiveConversation } from '../apps/messenger/live-conversation/live-conversation.tsx'
import { MyDevices } from '../apps/messenger/my-devices/my-devices.tsx'
import {
  MakeRecoveryKey,
  type RecoveryKit,
  UseRecoveryKey,
} from '../apps/messenger/recovery/recovery.tsx'
import type { Messenger } from '../apps/messenger/service/messenger.ts'
import {
  ExportData,
  ImportData,
  type PassphraseSeal,
} from '../apps/messenger/your-data/your-data.tsx'
import { createBrowserCrypto } from '../platform/crypto/browser-crypto.ts'
import { createPassphraseSeal } from '../platform/crypto/passphrase.ts'
import { generateRecoveryKey, recoverySigner } from '../platform/crypto/recovery-key.ts'
import { createWasmArgon2id } from '../platform/crypto/wasm-argon2id.ts'
import { browserFiles } from '../platform/files/browser-files.ts'
import type { ShellApi, ShellEnv } from '../shell/shell/types.ts'
import { brandIcon, tangoIcon } from '../ui/icons/icons.ts'
import type { MenuEntry } from '../ui/menu/menu.tsx'
import type { MessengerHost } from './messenger-host.ts'

/** The openers the Messenger's windows hand to the rest of the desktop. */
export interface MessengerWindows {
  readonly openMessenger: () => void
  readonly openConversation: (contactId: string) => void
  readonly openFriendConversation: (id: PeerId) => void
  readonly openAddFriend: (incoming?: IncomingInvite, tab?: AddFriendTab) => void
  readonly openJoinDevice: (incoming?: Invite, confirmed?: boolean) => void
  readonly openMyDevices: () => void
  readonly openMakeRecoveryKey: () => void
  /** The id of a friend's conversation window. */
  readonly conversationWindow: (contactId: string) => string
}

/** What the Messenger's windows need from programs.tsx besides the shell and the host. */
export interface MessengerWindowOpeners {
  readonly openAbout: () => void
  readonly setRelayOnly: (on: boolean) => Promise<void>
}

export function createMessengerWindows(
  api: ShellApi,
  env: ShellEnv,
  host: MessengerHost,
  { openAbout, setRelayOnly }: MessengerWindowOpeners,
): MessengerWindows {
  // Each new conversation opens 20px down and right of the last, like the era's cascade, and
  // the first lands where the Desktop board draws it.
  let conversations = 0
  const cascade = () => {
    const step = conversations % 5
    conversations += 1
    return { x: 318 + step * 20, y: 116 + step * 20, width: 490, height: 540 }
  }
  const conversationWindow = (contactId: string) => `conversation:${contactId}`

  const openFriendConversation = (id: PeerId) => {
    const messenger = host.messenger()
    const friend = messenger?.friend(id)
    if (messenger === undefined || friend === undefined) return
    const windowId = conversationWindow(id)
    api.open(windowId, {
      title: `${friend.name} - Conversation`,
      taskTitle: friend.name,
      icon: brandIcon('messenger-16'),
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

  const openConversation = (contactId: string) => openFriendConversation(contactId)

  const openAddFriend = (incoming?: IncomingInvite, tab?: AddFriendTab) => {
    // A link from the address bar, or a tab asked for, replaces whatever the window was showing.
    if (incoming !== undefined || tab !== undefined) api.close('add-friend')
    api.open('add-friend', {
      title: 'Add a Friend',
      icon: tangoIcon('contact-new', 16),
      bounds: { x: 232, y: 80, width: 560, height: 480 },
      controls: { maximize: false },
      content: (window) => (
        <Show
          when={host.messenger()}
          fallback={<p>{host.problem() ?? 'Pigeon is still starting...'}</p>}
          keyed
        >
          {(messenger) => (
            <AddFriend
              messenger={messenger}
              incoming={incoming}
              tab={tab}
              copyText={host.copyText}
              sleep={host.sleep}
              onOpenConversation={openFriendConversation}
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
  const openJoinDevice = (incoming?: Invite, confirmed = false) => {
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
          keyed
        >
          {(messenger) => (
            <JoinDevice
              messenger={messenger}
              incoming={incoming}
              confirmed={confirmed}
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
  const passphraseSeal: PassphraseSeal = createPassphraseSeal({ argon2id: createWasmArgon2id() })
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

  const openMessenger = () =>
    api.open('messenger', {
      title: 'Pigeon',
      icon: brandIcon('messenger-16'),
      bounds: { x: 818, y: 8, width: 200, height: 600 },
      resizable: true,
      controls: { maximize: false },
      content: (window) => (
        <BuddyList
          messenger={host.messenger()}
          problem={host.problem()}
          onOpenConversation={openConversation}
          onAddFriend={(tab) => openAddFriend(undefined, tab)}
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
  return {
    openMessenger,
    openConversation,
    openFriendConversation,
    openAddFriend,
    openJoinDevice,
    openMyDevices,
    openMakeRecoveryKey,
    conversationWindow,
  }
}
