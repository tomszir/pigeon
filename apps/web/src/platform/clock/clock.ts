// Time, passed in so code that waits or stamps messages can be tested with a fake.

export interface Clock {
  /** Milliseconds since the epoch. */
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}
