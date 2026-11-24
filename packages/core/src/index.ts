export type { Err, Ok, Result } from './result/result.ts'
export { err, ok } from './result/result.ts'
export type { PeerId, Room, RoomName, Transport } from './transport/transport.ts'
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
