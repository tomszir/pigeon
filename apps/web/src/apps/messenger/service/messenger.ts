// What the Messenger shows the windows: the views and results its members hand out, and the
// interface that holds them, written out in roles so a reader can see what a Messenger can do
// without reading the code that does it. service.ts builds one; its return type and this
// interface must stay assignable to each other (messenger.test.ts checks).
import type {
  AvatarTraits,
  ChatLog,
  ClientError,
  Invite,
  Json,
  LighthouseAddress,
  LighthouseSoftware,
  LiveCode,
  LogEntry,
  Offer,
  OpenResult,
  OpenStep,
  PeerId,
  Presence,
  Result,
  Signer,
} from '@pigeon/core'
import type { Accessor } from 'solid-js'
import type { DeviceStatus, DeviceView } from './devices.ts'
import type {
  AskResult,
  MakeLinkError,
  OpenedLink,
  OtherLink,
  OwnLink,
  SentAsk,
} from './invite-links.ts'
import type { MessageRoute } from './letters.ts'
import type {
  BlockedRecord,
  FriendRecord,
  HostedInvite,
  MailBook,
  MessengerSettings,
  Profile,
} from './stored.ts'

export interface FriendView extends FriendRecord {
  /** How many devices they have on their list. */
  readonly devices: number
  /**
   * Their Pigeon accepts messages from this device. False when this isn't your first device and
   * theirs is from before device logs: they hear your first device only, until they update.
   */
  readonly seesThisDevice: boolean
  /** The petname if you gave one, else their handle: what every screen shows. */
  readonly name: string
  readonly fingerprint: string
  readonly online: boolean
  readonly presence: Presence
  readonly typing: boolean
  readonly log: ChatLog
  /** Messages from them that arrived since you last looked. */
  readonly unread: number
  /** Buzzes, comings and goings this visit, not kept: each sits after `after` chat entries. */
  readonly notes: readonly Note[]
}

export interface Note {
  readonly id: number
  readonly kind: 'buzz-in' | 'buzz-out' | 'online' | 'offline'
  readonly after: number
  readonly at: number
}

export interface MessengerEvents {
  readonly onPaired?: (friend: FriendView) => void
  /** Someone proved they hold your live code and asks to be friends: they wait for Add. */
  readonly onCodeAsk?: (ask: CodeAsk) => void
  /** Another of your devices took this one off your list. */
  readonly onDeviceRemoved?: () => void
  /** This device's key is open somewhere else too: a copied profile. Once a run. */
  readonly onTwin?: () => void
  readonly onMessage?: (friend: FriendView, entry: LogEntry) => void
  readonly onBuzz?: (friend: FriendView) => void
  readonly onOnline?: (friend: FriendView) => void
  readonly onUnfriended?: (friend: FriendView) => void
  /**
   * Saved friends that couldn't be read were kept aside as they were stored, and everyone else
   * loaded. `count` is every record kept aside so far, this run's and earlier runs'.
   */
  readonly onFriendsSetAside?: (count: number) => void
  /** The same for blocked people whose saved records couldn't be read. */
  readonly onBlockedSetAside?: (count: number) => void
  /** The same for saved farewells (friends you removed who haven't been told) that couldn't be read. */
  readonly onFarewellsSetAside?: (count: number) => void
}

export type ImportResult = 'imported' | 'not-yours' | 'unreadable'

/** Recovering onto this Pigeon: done, or why not. */
export type RecoverResult = 'recovered' | 'own' | 'linked' | 'has-friends' | 'waiting' | 'refused'

/**
 * Linking a device from this one: the code it shows, and who asked, once someone has. Wrong
 * tries are confirmations that didn't hold; `stopped` once there were too many.
 */
export interface LinkingState {
  readonly code: LiveCode
  readonly link: string
  readonly expiresAt: number
  readonly wrongTries: number
  readonly stopped: boolean
  readonly request?: {
    readonly device: PeerId
    readonly fingerprint: string
    readonly name: string
  }
}

/** Linking this device to another's identity: who answered, and this device's fingerprint. */
export interface DeviceOffer {
  readonly handle: string
  /** This device's own fingerprint, which the other device shows too. */
  readonly fingerprint: string
  /** The identity's fingerprint: from a typed code, compare it with the other device's own. */
  readonly identityFingerprint: string
  /** It came from a link, whose fingerprint it matched. */
  readonly checked: boolean
  /**
   * Asks to be linked, and resolves true once confirmed on the other device and this one has
   * taken it all in.
   */
  confirmed(until: Promise<void>): Promise<boolean>
  cancel(): Promise<void>
}

/** How far leaving a Pigeon has got: removing friends here, then telling them. */
export interface LeaveProgress {
  readonly step: 'removing' | 'telling'
  /** Friends removed, or friends who have heard, so far. */
  readonly done: number
  readonly total: number
}

export type JoinedIdentity =
  | { readonly ok: true; readonly offer: DeviceOffer }
  | {
      readonly ok: false
      readonly error:
        | 'stopped'
        | 'impostor'
        | 'wrong-code'
        | 'has-friends'
        | 'has-devices'
        | 'waiting'
        | 'own'
    }

/** Someone who proved they hold your code and asks to be friends, as Add a Friend shows them. */
export interface CodeAsk {
  readonly key: string
  readonly id: PeerId
  readonly handle: string
  readonly fingerprint: string
}

/** An invite's answer as the Messenger hands it on: confirming adds the friend here too. */
export interface FriendOffer extends Omit<Offer, 'confirm'> {
  /**
   * Asks to be friends; true once the inviter has added you, `declined` if they said no, false
   * if `until` gives up first.
   */
  confirm(until: Promise<void>): Promise<boolean | 'declined'>
}

export type OpenedInvite =
  | { readonly ok: true; readonly offer: FriendOffer }
  | Extract<OpenResult, { ok: false }>
  | { readonly ok: false; readonly error: 'own' }
  /** The inviter is someone you blocked. */
  | { readonly ok: false; readonly error: 'blocked'; readonly handle: string }

/** Who you are: your identity, this device's key, and the name and picture you show. */
export interface MessengerProfile {
  /** Your identity, the same on all your devices: what friends and birds know you by. */
  self: string
  /** This device's own key. */
  device: string
  /** Whether a chat entry is yours, from any of your devices. */
  isMine: (author: PeerId) => boolean
  selfFingerprint: string
  fingerprintOf: (id: PeerId) => Promise<string>
  /** The traits of someone's pixel pigeon (docs/design.md, Avatars). */
  avatarOf: (id: PeerId) => Promise<AvatarTraits>
  profile: Accessor<Profile>
  setProfile(next: Profile): Promise<void>
}

/** Your friends and the people you've blocked. */
export interface MessengerFriends {
  friends: () => readonly FriendView[]
  friend: (id: PeerId) => FriendView | undefined
  onlineCount: () => number
  isFriend: (id: string) => boolean
  /** Calls a friend something of your own; an empty name goes back to theirs. */
  rename(id: PeerId, petname: string): Promise<void>
  /** Quiets a friend until `until` (a time, or MUTED_FOREVER); undefined unmutes. */
  mute(id: PeerId, until: number | undefined): Promise<void>
  muted(id: PeerId): boolean
  remove: (id: PeerId, options: { block: boolean }) => Promise<void>
  blocked: Accessor<readonly BlockedRecord[]>
  unblock(id: PeerId): Promise<void>
}

/** Talking in a chat with a friend. */
export interface MessengerChats {
  send(id: PeerId, text: string): Promise<void>
  /** Call on every edit of the draft; it throttles what goes on the wire. */
  typing(id: PeerId, active: boolean): void
  buzz(id: PeerId): void
  markRead: (id: PeerId) => void
}

/** Becoming friends: your live code, the links you make, and answering other people's. */
export interface MessengerInvites {
  invite: Accessor<HostedInvite | undefined>
  inviteLink: () => string | undefined
  inviteCode: () => string | undefined
  newInvite: () => Promise<HostedInvite | undefined>
  /** People who proved they hold your code, waiting for you to add or decline them. */
  codeAsks: Accessor<readonly CodeAsk[]>
  approveAsk: (key: string) => Promise<boolean>
  declineAsk: (key: string) => Promise<void>
  /** Wrong confirmations your current code has had. */
  wrongTries: Accessor<number>
  /** Your last code was stopped after too many wrong tries. */
  inviteStopped: Accessor<boolean>
  /**
   * Answers someone's invite and waits to hear who they are. Nothing is agreed until the
   * returned offer is confirmed, which adds the friend on both sides.
   */
  open(
    target: Invite,
    until: Promise<void>,
    onStep?: (step: OpenStep) => void,
  ): Promise<OpenedInvite>
  /** Invite links this device made, with who asked through each. */
  inviteLinks: () => readonly OwnLink[]
  /** Invite links your other devices made. */
  inviteLinksElsewhere: () => readonly OtherLink[]
  /** Requests you sent through someone's link, waiting for their answer. */
  sentAsks: () => SentAsk[]
  /** Makes an invite link; undefined when this Pigeon can't reach Lighthouses. */
  makeInviteLink: (options: {
    lifetime: number
    uses: number
  }) => Promise<{ ok: true; link: OwnLink } | { ok: false; error: MakeLinkError }>
  cancelInviteLink: (secret: string) => Promise<void>
  approveRequest: (secret: string, identity: PeerId) => Promise<boolean>
  declineRequest: (secret: string, identity: PeerId) => Promise<void>
  /** Looks up someone's invite link at the Lighthouses. */
  openInviteLink: (text: string) => Promise<OpenedLink>
  /** Asks to be friends through a link opened with `openInviteLink`. */
  askThroughLink: (opened: Extract<OpenedLink, { ok: true }>) => Promise<AskResult>
  forgetAsk: (secret: string) => Promise<void>
}

/** Your devices: the list, linking another, recovering, and the recovery key. */
export interface MessengerDevices {
  deviceStatus: () => DeviceStatus
  /** This device's key was heard from another run: a copied profile. */
  twin: Accessor<boolean>
  devices: () => readonly DeviceView[]
  /**
   * The secret your devices meet with was replaced, since it may have been seen while a device
   * was linked: My Devices asks you to check every device on the list is yours.
   */
  checkDevices: Accessor<boolean>
  /** You've checked: My Devices stops asking. */
  devicesChecked(): Promise<void>
  /** A first device with nobody on it: it can be linked to another identity. */
  canJoin: () => boolean
  /** Recovered, and waiting for an old friend to hand back the whole list. */
  waitingForList: () => boolean
  linking: Accessor<LinkingState | undefined>
  startLink: () => Promise<LinkingState | undefined>
  confirmLink: (name: string) => Promise<'linked' | 'failed' | 'too-big'>
  refuseLink: () => Promise<void>
  cancelLink: () => Promise<void>
  joinIdentity: (target: Invite, until: Promise<void>) => Promise<JoinedIdentity>
  /** This is the first device, the only one that links and removes devices. */
  isFirstDevice: () => boolean
  /** Your recovery key's public half, while you have one. */
  recoveryKey: () => string | undefined
  /** The epoch a recover with your current key would start. */
  nextEpoch: () => number
  /** Commits your list to a new recovery key, on the first device while it has none. */
  commitRecoveryKey(key: PeerId): Promise<boolean>
  /**
   * Uses your recovery key on this device, which is already you: it writes your list from now
   * on, the others stay only if `keepOthers`, and `next` is the key from now on.
   */
  recoverHere(key: Signer, keepOthers: boolean, next: PeerId): Promise<boolean>
  recoverIdentity: (
    identity: PeerId,
    epoch: number,
    key: Signer,
    next: PeerId,
  ) => Promise<RecoverResult>
  /** True the first time it's asked: whether to remind you to make a recovery key. */
  remindRecoveryOnce(): Promise<boolean>
  /** Takes a device off your list, from the first device. */
  removeDevice(id: PeerId): Promise<void>
  renameDevice(id: PeerId, name: string): Promise<void>
}

/** Mail through Lighthouses: where it's left, looking for it, and what became of a message. */
export interface MessengerMail {
  /** Where friends leave mail for this Pigeon. */
  lighthouses: Accessor<readonly LighthouseAddress[]>
  /** Changes where mail is left for you, and says so to friends and your other devices. */
  setLighthouses(next: readonly LighthouseAddress[]): Promise<void>
  /** What `id`'s devices (your own, under your own id) said about their mail. */
  mailBook: (id: PeerId) => Promise<MailBook>
  /** Looks for mail now, rather than at the next few-minute check. */
  checkMail: () => Promise<void>
  /**
   * What Check Now shows: when Pigeon last finished looking for mail (undefined before the
   * first look) and whether a look is under way or waiting for its turn.
   */
  mailLook: () => { at: number | undefined; state: 'checking' | 'idle' | 'waiting' }
  /**
   * Check Now: looks for mail as soon as the scheduler allows, through the same path as a tab
   * shown or a message sent, so two looks never run at once and one never starts within
   * MAIL_MIN_GAP_MS of the last. Says how long it waits for that gap (0 when it starts at
   * once); a look already under way is followed by this one.
   */
  checkNow(): number
  /**
   * Try Again: puts at once what you wrote to `id` that no Lighthouse took yet, and says each
   * message's way as it is. True when nothing is left unsent.
   */
  tryAgain: (id: PeerId) => Promise<boolean>
  /**
   * Whether a Lighthouse answers, and what it says it runs: its own claim, which nothing in
   * Pigeon relies on.
   */
  checkLighthouse(
    address: LighthouseAddress,
  ): Promise<Result<LighthouseSoftware, ClientError | 'no-client'>>
  /**
   * Where one of the chat's messages is: sealing, left at Lighthouses, received, or come by
   * letter. Received only on their word (a sync of theirs that holds it, or a receipt), so
   * nothing for one that went straight to them that they haven't said they hold. Call
   * `loadLetters` when the chat opens.
   */
  messageRoute: (id: PeerId, entry: LogEntry) => MessageRoute | undefined
  loadLetters: (id: PeerId) => Promise<void> | Promise<number>
}

/** How this Pigeon connects: the relay-only setting and how many signaling relays answer. */
export interface MessengerConnection {
  settings: Accessor<MessengerSettings>
  /** Turns relay-only connections on or off, and reconnects everything to match. */
  setRelayOnly: (relayOnly: boolean) => Promise<void>
  /**
   * Turns hearing about mail at once on or off. Off, the waits standing at your Lighthouses end
   * at once, their connections closed.
   */
  setHearAtOnce: (on: boolean) => Promise<void>
  /** How many signaling relays are reachable now, where the transport can tell. */
  relays: () => { readonly reachable: number; readonly total: number } | undefined
}

/** Your data: taking it out, bringing it back, and leaving Pigeon. */
export interface MessengerData {
  leavingTells: () => boolean
  leave: (until: Promise<void>, onProgress?: (progress: LeaveProgress) => void) => Promise<number>
  exportData: () => Json
  importData: (value: unknown) => Promise<ImportResult>
}

/** Staying running and shutting down. */
export interface MessengerLifecycle {
  /**
   * Work in flight that a reload would cut short or repeat: a chat saved to storage a moment
   * ago and not yet written, and a letter being sealed and put. What else is going on survives
   * a reload as it does a closing tab (the outbox, mail already fetched, a removal still to be
   * acted on and a pair secret being replaced are kept as they go and picked up on the next
   * start), so it isn't counted.
   */
  inFlight: () => boolean
  /** For a closing tab: friends see you go offline at once. */
  goodbye(): void
  close: () => Promise<void>
}

/** A running Messenger: everything the windows read and do, by role. */
export interface Messenger
  extends MessengerProfile,
    MessengerFriends,
    MessengerChats,
    MessengerInvites,
    MessengerDevices,
    MessengerMail,
    MessengerConnection,
    MessengerData,
    MessengerLifecycle {}
