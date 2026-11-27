// Where a Lighthouse keeps mail, as an interface: the Node runner keeps it in
// SQLite, the Worker in its Durable Objects' SQLite, and tests in memory. Nothing stored says who
// mail is from or for: a tag, sealed bytes, when it expires, and a hash per recipient device.

export interface StoredBlob {
  /**
   * SHA-256 of the tag, blob and drops (core's mailBlobId), and the owner for a claimed blob: an
   * unclaimed blob has one id everywhere, a claimed one an id at each Lighthouse.
   */
  readonly id: string
  readonly tag: string
  /** The sealed blob, base64, as it was put. */
  readonly blob: string
  /** Its size once decoded, for listing. */
  readonly size: number
  /** What it costs to keep, its record included (limits' blobCost), for the store's limit. */
  readonly cost: number
  readonly expires: number
  /** SHA-256 of each recipient device's drop value, base32. */
  readonly drops: readonly string[]
  /** The drop hashes already used. */
  readonly used: readonly string[]
  /** The order blobs reached this Lighthouse: `list`'s cursor counts it. It only rises. */
  readonly seq: number
  /** For a claimed blob, SHA-256 of its claim, base32; never told to anyone. */
  readonly owner?: string | undefined
}

export interface ListedPage {
  readonly items: readonly { readonly id: string; readonly tag: string; readonly size: number }[]
  /** The seq of the last blob listed, or the cursor given when none were. */
  readonly cursor: number
  readonly more: boolean
}

export type DropOutcome =
  | { readonly kind: 'used'; readonly remaining: number }
  | { readonly kind: 'wrong' }
  | { readonly kind: 'unknown' }

export interface MailStore {
  /**
   * Stores a blob unless one with its id is held and hasn't expired, and says which. An expired
   * one not yet swept is replaced, with a new seq, so it lists again. A claimed blob (one with an
   * `owner`) is refused as `taken` while its tag holds a claimed blob, not expired, of another
   * owner; the check and the write come together, so two claims at once can't both win.
   */
  put(blob: Omit<StoredBlob, 'seq' | 'used'>, now: number): Promise<'stored' | 'exists' | 'taken'>
  /**
   * Blobs under `tags` with a seq after `cursor` that haven't expired, oldest first; with
   * `claimed`, only the claimed ones.
   */
  list(
    tags: readonly string[],
    cursor: number,
    limit: number,
    now: number,
    claimed?: boolean,
  ): Promise<ListedPage>
  get(id: string, now: number): Promise<StoredBlob | undefined>
  /**
   * Uses one of a blob's drops, and deletes the blob once every drop is used. Two calls with the
   * same drop never both succeed.
   */
  useDrop(id: string, hash: string, now: number): Promise<DropOutcome>
  /**
   * The live blobs with a seq after `seq`, oldest first, at most `limit`, by tag: for a
   * Lighthouse waking from a reset to find the puts whose wakes it may not have sent.
   */
  after(
    seq: number,
    now: number,
    limit: number,
  ): Promise<readonly { readonly seq: number; readonly tag: string }[]>
  /** Deletes what has expired; says how many. */
  expire(now: number): Promise<number>
  /**
   * The cost of everything held, for the Lighthouse's limit on its whole store. It's asked on
   * every put, so a store keeps it as a running total rather than adding up what it holds.
   */
  totalBytes(): Promise<number>
}
