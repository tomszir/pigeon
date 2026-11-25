// The few Workers runtime types the Lighthouse uses, written out rather than pulling in
// @cloudflare/workers-types, as apps/web's Worker does.

export interface SqlCursor {
  toArray(): Record<string, string | number | null>[]
  readonly rowsWritten: number
}

export interface DurableObjectState {
  readonly storage: {
    readonly sql: { exec(query: string, ...bindings: (string | number | null)[]): SqlCursor }
    setAlarm(at: number): Promise<void>
    getAlarm(): Promise<number | null>
  }
  acceptWebSocket(socket: WebSocket): void
  getWebSockets(): WebSocket[]
}

/** A WebSocket the runtime hibernates: what it keeps with the socket while it sleeps. */
export interface HibernatingSocket extends WebSocket {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

export interface DurableObjectNamespace {
  idFromName(name: string): unknown
  get(id: unknown): DurableObjectStub
}

export interface Env {
  readonly LIGHTHOUSE: DurableObjectNamespace
  /** The Lighthouse's Ed25519 key, PKCS#8 in base64: a secret. */
  readonly LIGHTHOUSE_KEY: string
  readonly LIGHTHOUSE_NAME: string
  readonly LIGHTHOUSE_URL: string
  /** The build it was deployed from, if the deploy said. */
  readonly PIGEON_BUILD?: string
}
