export type { AvatarPixels, AvatarTraits } from './avatar/avatar.ts'
export {
  AVATAR_SIZE,
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
export { startPairSession } from './chat/pair-session.ts'
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
export type { Body, BodyType, DecodeError, Envelope, Status } from './messages/envelope.ts'
export {
  MAX_HANDLE_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_PERSONAL_MESSAGE_LENGTH,
  openEnvelope,
  sealEnvelope,
} from './messages/envelope.ts'
export type { Invite } from './pairing/invite.ts'
export {
  decodeInvite,
  encodeInviteLink,
  formatInviteCode,
  INVITE_CODE_BYTES,
  INVITE_CODE_LENGTH,
  INVITE_LIFETIME_MS,
  inviteCode,
  inviteRoom,
} from './pairing/invite.ts'
export type {
  HostInviteOptions,
  NewFriend,
  Offer,
  OpenInviteOptions,
  OpenResult,
  OpenStep,
} from './pairing/pairing.ts'
export { hostInvite, openInvite } from './pairing/pairing.ts'
export type { Err, Ok, Result } from './result/result.ts'
export { err, ok } from './result/result.ts'
export { createMemoryNetwork, fakeCrypto, fakeSigner, flush } from './testing/testing.ts'
export type { ConnectionId, Room, RoomName, Transport } from './transport/transport.ts'
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
