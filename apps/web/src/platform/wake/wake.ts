// The moments a Pigeon that has been left alone may have missed something, passed in so the
// Messenger can be tested without a browser.

export interface Wake {
  /**
   * Calls `listener` whenever the person may have come back or the network returned: the tab
   * shows again, the window gets focus, the connection comes back. Returns a function that stops it.
   */
  readonly on: (listener: () => void) => () => void
}
