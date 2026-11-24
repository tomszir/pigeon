export type { Err, Ok, Result } from './result.ts'
export { err, ok } from './result.ts'
export type { PeerId, Room, RoomName, Transport } from './transport.ts'
export type { Bounds, Desktop, ManagedWindow, WindowId, Workspace } from './window-manager.ts'
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
} from './window-manager.ts'
