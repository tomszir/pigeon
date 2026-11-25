// One tab at a time (decision 0028). Two tabs would be the same device twice in every room, which
// is what a copied profile looks like, so a tab runs the Messenger only while it holds a Web Lock.
// Another tab asks for it over a BroadcastChannel; the one holding it lets go and says so.

const LOCK = 'pigeon-messenger'
const CHANNEL = 'pigeon-tabs'
const TAKE = 'take'

/** The parts of the Web Locks API used here, so tests can stand in for it. */
export interface Locks {
  request(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>
}

/** The parts of BroadcastChannel used here. */
export interface Channel {
  postMessage(message: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
}

export interface TabLock {
  /** True once this tab holds it; false when another tab already does. */
  tryHold(): Promise<boolean>
  /** Asks the tab holding it to let go, and resolves once this one holds it. */
  takeOver(): Promise<void>
}

export interface TabLockDeps {
  /** Undefined where the browser has no Web Locks: every tab runs, as before. */
  readonly locks: Locks | undefined
  readonly channel: Channel | undefined
  /** Another tab took over: stop the Messenger here. The lock goes once it resolves. */
  readonly onLost: () => Promise<void>
}

export function createTabLock(deps: TabLockDeps): TabLock {
  let release: (() => void) | undefined

  if (deps.channel !== undefined)
    deps.channel.onmessage = (event) => {
      if (event.data !== TAKE || release === undefined) return
      const letGo = release
      release = undefined
      void deps.onLost().finally(letGo)
    }

  const hold = (ifAvailable: boolean) =>
    new Promise<boolean>((resolve, reject) => {
      const locks = deps.locks
      if (locks === undefined) {
        resolve(true)
        return
      }
      locks
        .request(LOCK, ifAvailable ? { ifAvailable: true } : {}, (lock) => {
          if (lock === null) {
            resolve(false)
            return
          }
          resolve(true)
          return new Promise<void>((done) => {
            release = done
          })
        })
        .catch(reject)
    })

  return {
    tryHold: () => (release !== undefined ? Promise.resolve(true) : hold(true)),
    async takeOver() {
      if (release !== undefined) return
      deps.channel?.postMessage(TAKE)
      await hold(false)
    },
  }
}

/** The browser's own Web Locks and BroadcastChannel, where it has them. */
export function browserTabLock(onLost: () => Promise<void>): TabLock {
  return createTabLock({
    locks: typeof navigator !== 'undefined' ? (navigator.locks as Locks | undefined) : undefined,
    channel:
      typeof BroadcastChannel === 'undefined'
        ? undefined
        : (new BroadcastChannel(CHANNEL) as unknown as Channel),
    onLost,
  })
}
