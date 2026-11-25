export type { AvatarPixels, AvatarTraits } from './avatar/avatar.ts'
export {
  AVATAR_SIZE,
  AVATAR_VERSION,
  avatarFor,
  avatarSvg,
  avatarTraits,
  describeAvatar,
  drawAvatar,
} from './avatar/avatar.ts'
export type { ChatLog, LogEntry, LogSummary } from './chat/chat-log.ts'
export {
  appendMessage,
  batchEntries,
  emptyLog,
  MAX_TEXT_LENGTH,
  mergeEntries,
  missingFrom,
  summarize,
} from './chat/chat-log.ts'
export type { PairEvent, PairSession, PairSessionOptions, Presence } from './chat/pair-session.ts'
export { encodeInstance, INSTANCE_BYTES, startPairSession } from './chat/pair-session.ts'
export type {
  AppendError,
  DeviceEntry,
  DeviceEntryKind,
  DeviceInfo,
  DeviceLog,
  DeviceState,
  Epoch,
  KeptDevice,
  RecoverEntry,
  RecoveryKey,
} from './devices/device-log.ts'
export {
  appendDeviceEntry,
  deviceState,
  emptyDeviceLog,
  everDevices,
  FIRST_DEVICE_NAME,
  isDeviceLog,
  isTailLog,
  MAX_DEVICE_NAME_LENGTH,
  MAX_KEPT_DEVICES,
  mergeDeviceLogs,
  recoverDeviceLog,
  setRecoveryKey,
  speakerIdentity,
  verifyDeviceLog,
  verifyOwnTail,
} from './devices/device-log.ts'
export type { Json } from './encoding/canonical.ts'
export { canonicalBytes } from './encoding/canonical.ts'
export type { Crypto, Signer } from './identity/crypto.ts'
export type { KeyKind, PeerId, PublicKey } from './identity/identity.ts'
export {
  fingerprint,
  formatFingerprint,
  isPeerId,
  pairRoom,
  parsePeerId,
  peerIdFromPublicKey,
} from './identity/identity.ts'
export type {
  Body,
  BodyType,
  DecodeError,
  Envelope,
  Speaker,
  Status,
} from './messages/envelope.ts'
export {
  MAX_HANDLE_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_PERSONAL_MESSAGE_LENGTH,
  openEnvelope,
  sealEnvelope,
} from './messages/envelope.ts'
export type { Invite } from './pairing/invite.ts'
export {
  decodeDeviceLink,
  decodeInvite,
  encodeDeviceLink,
  encodeInviteLink,
  formatInviteCode,
  INVITE_CODE_BYTES,
  INVITE_CODE_LENGTH,
  INVITE_LIFETIME_MS,
  inviteCode,
  inviteRoom,
} from './pairing/invite.ts'
export type {
  HostLinkOptions,
  LinkOffer,
  LinkRequest,
  OpenLinkOptions,
  OpenLinkResult,
} from './pairing/link.ts'
export { hostLink, linkCheck, linkRoom, openLink } from './pairing/link.ts'
export type { PairPlace, PairRoomSpec } from './pairing/pair-rooms.ts'
export {
  encodePairSecret,
  isPairSecret,
  PAIR_SECRET_BYTES,
  pairDaysAt,
  pairPassword,
  pairRoomOn,
  pairRoomsAt,
  selfRoomsAt,
  untilPairDaysChange,
  utcDay,
} from './pairing/pair-rooms.ts'
export type {
  Accepted,
  HostInviteOptions,
  NewFriend,
  Offer,
  OpenInviteOptions,
  OpenResult,
  OpenStep,
} from './pairing/pairing.ts'
export { hostInvite, openInvite } from './pairing/pairing.ts'
export type { RecoveryCode, RecoveryCodeError } from './recovery/recovery-code.ts'
export {
  decodeRecoveryCode,
  encodeRecoveryCode,
  RECOVERY_SEED_BYTES,
} from './recovery/recovery-code.ts'
export type { Err, Ok, Result } from './result/result.ts'
export { err, ok } from './result/result.ts'
export { createMemoryNetwork, fakeCrypto, fakeSigner, flush } from './testing/testing.ts'
export type {
  ConnectionId,
  JoinOptions,
  Room,
  RoomName,
  Transport,
} from './transport/transport.ts'
export type {
  Bounds,
  Desktop,
  ManagedWindow,
  WindowId,
  Workspace,
} from './windows/window-manager.ts'
export {
  blurAll,
  closeWindow,
  emptyDesktop,
  findWindow,
  fitBounds,
  focusWindow,
  isMaximized,
  minimizeWindow,
  moveWindow,
  openWindow,
  placeBounds,
  refitWindows,
  resizeWindow,
  toggleFromTaskbar,
  toggleMaximize,
} from './windows/window-manager.ts'
