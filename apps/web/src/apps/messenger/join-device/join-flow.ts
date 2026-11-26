// What the Link to My Other Device window can be showing, and what it says when linking fails.
import type { Invite } from '@pigeon/core'
import type { DeviceOffer, LeaveProgress } from '../service/messenger.ts'

export type Join =
  | { readonly kind: 'enter'; readonly error?: string }
  /** Opened from a link: asks before linking, since anyone can send one. */
  | { readonly kind: 'arrived'; readonly target: Invite }
  | { readonly kind: 'looking' }
  /** Whose Pigeon answered; `asked` once this device has asked to be linked. */
  | { readonly kind: 'offer'; readonly offer: DeviceOffer; readonly asked: boolean }
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly text: string }
  | { readonly kind: 'taken'; readonly target: Invite; readonly text: string }
  | { readonly kind: 'leave'; readonly target: Invite }
  | {
      readonly kind: 'leaving'
      readonly startedAt: number
      readonly progress: LeaveProgress | undefined
      /** Forgetting has begun: nothing to wait for any more. */
      readonly forgetting: boolean
    }

export const FAILURES: Readonly<Record<string, string>> = {
  stopped:
    'Nobody answered. Pigeon has to be open on your other device, with Link a Device showing.',
  impostor: "Whoever answered isn't the Pigeon in the link. Nothing was linked.",
  'wrong-code':
    "Your other device says that code is wrong. Check it and type it again: it's the one Link a Device shows now.",
  'has-friends':
    "This Pigeon already has friends of its own. Only a Pigeon with none can be linked, since it takes on the other one's.",
  'has-devices':
    'This Pigeon is already someone’s. Only a new Pigeon can be linked, since it becomes the other one.',
  waiting:
    'This Pigeon was recovered and is waiting for a friend to hand back its list. Linking it now would lose the recovery.',
  own: "That's this device's own code.",
}

/** Whether `view` is the step `kind`, which narrows the union. */
export function isKind<K extends Join['kind']>(
  view: Join,
  kind: K,
): view is Extract<Join, { readonly kind: K }> {
  return view.kind === kind
}
