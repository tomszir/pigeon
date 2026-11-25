// Pages that come with Pigeon, served "On this computer" (decision 0032). Each set of pages is a
// map from address to page; Explorer looks an address up in every set it's given, in order.
import { brand } from '../../../ui/icons/icons.ts'
import { canonicalAddress, HOME_ADDRESS } from '../explorer/address.ts'
import homeSource from './home.html?raw'

export interface LocalPage {
  readonly title: string
  /** The page's PigeonHTML, sanitized like anyone's before it's shown. */
  readonly source: string
  /** A relative `src` the page names, to the bundled asset it's served from. */
  readonly images?: Readonly<Record<string, string>>
}

/** A set of bundled pages by address. Help's pages are another such map. */
export type LocalPages = ReadonlyMap<string, LocalPage>

/** The start page Home goes to. */
export const START_PAGES: LocalPages = new Map([
  [
    HOME_ADDRESS,
    {
      title: 'Pigeon Home',
      source: homeSource,
      images: { 'pigeon.png': brand('pigeon-48') },
    },
  ],
])

const spelling = (address: string): string => {
  try {
    return canonicalAddress(new URL(address)) ?? address
  } catch {
    return address
  }
}

/** Looks an address up in each set in turn; the first that has it wins. */
export function localPageFinder(
  ...sets: readonly LocalPages[]
): (address: string) => LocalPage | undefined {
  const pages = new Map<string, LocalPage>()
  for (const set of sets) {
    for (const [address, page] of set) {
      const key = spelling(address)
      if (!pages.has(key)) pages.set(key, page)
    }
  }
  return (address) => pages.get(spelling(address))
}

/** Every page that comes with Pigeon. */
export const findLocalPage = localPageFinder(START_PAGES)
