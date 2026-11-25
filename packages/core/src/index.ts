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
export type { BackEntry, BackStack, HistoryPort } from './back/back-stack.ts'
export { createBackStack } from './back/back-stack.ts'
export type { ChatLog, LogEntry, LogSummary } from './chat/chat-log.ts'
export {
  appendMessage,
  batchEntries,
  emptyLog,
  isLogEntry,
  MAX_TEXT_LENGTH,
  mergeEntries,
  missingFrom,
  summarize,
} from './chat/chat-log.ts'
export type {
  PairEvent,
  PairSession,
  PairSessionOptions,
  Presence,
  ProfileChange,
} from './chat/pair-session.ts'
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
export {
  base32Decode,
  base32Encode,
  base64Decode,
  base64Encode,
  bytesEqual,
  utf8Encode,
} from './encoding/bytes.ts'
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
export type { LighthouseAddress } from './lighthouse/address.ts'
export {
  formatLighthouseAddress,
  isLighthouseAddress,
  MAX_LIGHTHOUSE_NAME_LENGTH,
  parseLighthouseAddress,
} from './lighthouse/address.ts'
export type {
  ClientError,
  ClientOptions,
  LighthouseClient,
  LighthouseSocket,
  OpenSocket,
  SocketEvents,
} from './lighthouse/client.ts'
export { createLighthouseClient, MAX_WAITING } from './lighthouse/client.ts'
export type {
  LighthouseError,
  LighthouseFrame,
  LighthouseReply,
  LighthouseRequest,
  LighthouseSoftware,
  ListedItem,
  ReplyError,
  ReplyTo,
  SignedReply,
} from './lighthouse/protocol.ts'
export {
  encodeRequest,
  frameHash,
  frameReq,
  frameText,
  isMailKey,
  LIGHTHOUSE_PROTOCOL,
  LIST_PAGE,
  MAIL_KEY_BYTES,
  MAX_BLOB_BYTES,
  MAX_DROPS,
  MAX_FRAME_BYTES,
  MAX_LIST_TAGS,
  MAX_MAIL_MS,
  mailBlobId,
  openReply,
  parseRequest,
  sealReply,
} from './lighthouse/protocol.ts'
export type {
  Letter,
  LogHead,
  MailExpected,
  MailKind,
  OpenError,
  OpenedMail,
  SealError,
  SealedMail,
  SealingKey,
} from './mail/mail.ts'
export {
  bindSealingKey,
  dropHashes,
  isSealingKey,
  mailTag,
  openMail,
  sealMail,
  utcDate,
  verifySealingKey,
} from './mail/mail.ts'
export type { SealCrypto, Sealer } from './mail/seal-crypto.ts'
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
  MAX_LIGHTHOUSES,
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
export type {
  CardError,
  InviteAnswer,
  InviteCard,
  InviteLink,
  InviteRequest,
} from './pairing/mailed-invite.ts'
export {
  DEFAULT_INVITE_LINK_LIFETIME,
  DEFAULT_INVITE_LINK_USES,
  decodeInviteLink,
  encodeInviteLinkFragment,
  INVITE_LINK_LIFETIMES,
  INVITE_LINK_USES,
  INVITE_SECRET_BYTES,
  inviteAnswerBody,
  inviteAnswerTag,
  inviteAskTag,
  inviteCardTag,
  inviteExpiry,
  inviteRequestBody,
  isInviteSecret,
  LINK_FINGERPRINT_BYTES,
  linkFingerprint,
  logProgress,
  MAX_INVITE_LINK_LIFETIME,
  MAX_INVITE_REQUEST_BYTES,
  MAX_INVITE_REQUESTS_PER_DAY,
  newestCard,
  openInviteCard,
  readInviteAnswer,
  readInviteRequest,
  sealInviteCard,
} from './pairing/mailed-invite.ts'
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
export {
  createMemoryNetwork,
  fakeCrypto,
  fakeSealCrypto,
  fakeSigner,
  flush,
} from './testing/testing.ts'
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
