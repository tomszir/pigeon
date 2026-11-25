// The Worker Lighthouse (decision 0037): every request goes to the one Durable Object that is
// this Lighthouse, with the client's address from Cloudflare, for the limits. A header a client
// sends claiming an address of its own is dropped.
import { CLIENT_ADDRESS, LighthouseObject } from './object/lighthouse-object.ts'
import type { Env } from './platform/worker-types.ts'

export { LighthouseObject }

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname !== '/') return Promise.resolve(new Response('', { status: 404 }))
    const headers = new Headers(request.headers)
    headers.delete(CLIENT_ADDRESS)
    headers.set(CLIENT_ADDRESS, request.headers.get('cf-connecting-ip') ?? 'unknown')
    const stub = env.LIGHTHOUSE.get(env.LIGHTHOUSE.idFromName('lighthouse'))
    return stub.fetch(new Request(request, { headers }))
  },
}
