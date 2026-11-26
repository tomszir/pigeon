// What the Messenger needs from the composition root. It is its own file because programs.tsx
// builds the Messenger's windows (messenger-windows.tsx) and both take a host: a type in either
// would make the two import each other.
import type { Invite } from '@pigeon/core'
import type { Accessor } from 'solid-js'
import type { Messenger } from '../apps/messenger/service/messenger.ts'

/** What the Messenger needs from the composition root. */
export interface MessengerHost {
  readonly messenger: Accessor<Messenger | undefined>
  /** Why Pigeon can't run here, when it can't. */
  readonly problem: Accessor<string | undefined>
  readonly copyText: (text: string) => Promise<boolean>
  readonly sleep: (ms: number) => Promise<void>
  /** Starts Pigeon again, as a newly linked device must to become its identity. */
  readonly restart: () => void
  /**
   * Forgets everything here and starts again at Link to My Other Device, linking to
   * `target` straight away when it's given, as leaving a Pigeon does.
   */
  readonly startOver: (target?: Invite) => Promise<void>
}
