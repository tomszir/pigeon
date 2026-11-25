// Back and Forward: the addresses visited in this window, and which one is showing.

export interface History {
  readonly entries: readonly string[]
  readonly index: number
}

export const startHistory = (address: string): History => ({ entries: [address], index: 0 })

export const currentAddress = (history: History): string => history.entries[history.index] ?? ''

/** Opens an address: the pages ahead of this one are forgotten, and the same page isn't added twice. */
export function visit(history: History, address: string): History {
  if (currentAddress(history) === address) return history
  const entries = [...history.entries.slice(0, history.index + 1), address]
  return { entries, index: entries.length - 1 }
}

export const canGoBack = (history: History): boolean => history.index > 0

export const canGoForward = (history: History): boolean =>
  history.index < history.entries.length - 1

export const goBack = (history: History): History =>
  canGoBack(history) ? { ...history, index: history.index - 1 } : history

export const goForward = (history: History): History =>
  canGoForward(history) ? { ...history, index: history.index + 1 } : history
