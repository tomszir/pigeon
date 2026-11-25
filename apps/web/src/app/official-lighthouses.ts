// The Lighthouses a new Pigeon leaves its mail at until it's told otherwise: the official ones,
// one a Cloudflare Worker and one a Node Lighthouse reached through Tailscale Funnel. Each holds
// mail it can't open or tie to anyone, so using both is how mail survives one being down. A
// Lighthouse is named by its key, which every reply it sends is checked against.
import { type LighthouseAddress, parseLighthouseAddress } from '@pigeon/core'

const ADDRESSES = [
  'pigeon://lighthouse/nopmovww5omjm2ydepi5tdnt7rc7go6qvjl43oji52oorhly6fpq?url=wss%3A%2F%2Flighthouse.pigeon.tomszir.com%2F&name=Pigeon%20Lighthouse',
  'pigeon://lighthouse/l3x5cr6mfosvdvdvxjzcj5spaeauhkuzgq7phw7oocnt43ofkawq?url=wss%3A%2F%2Fcore.tail8c509f.ts.net%2F&name=Pigeon%20Lighthouse%20Node',
]

export const OFFICIAL_LIGHTHOUSES: readonly LighthouseAddress[] = ADDRESSES.map((text) => {
  const address = parseLighthouseAddress(text)
  if (!address.ok) throw new Error(`not a Lighthouse address: ${text}`)
  return address.value
})
