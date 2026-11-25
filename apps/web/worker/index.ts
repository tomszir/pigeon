// The pigeon Worker: static assets for everything, and one route that hands out
// TURN credentials. No user data passes through here.
import { handleTurn, type TurnEnv } from './turn.ts'

interface Env extends TurnEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/turn') return handleTurn(request, env)
    return env.ASSETS.fetch(request)
  },
}
