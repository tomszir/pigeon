// "How Pigeon Works": the hand-written half of Help, for people.

import type { HelpPage } from '../page/page.ts'
import { ADDING_A_FRIEND } from './adding-a-friend.ts'
import { COMING_SOON } from './coming-soon.ts'
import { CHAPTERS, chapterAddress, chapterPage } from './frame.ts'
import { ONE_PICTURE } from './one-picture.ts'
import { PRIVATE_ROOMS } from './private-rooms.ts'
import { RECOVERY_KEY } from './recovery-key.ts'
import { SAVING_YOUR_DATA } from './saving-your-data.ts'
import { YOUR_DEVICES } from './your-devices.ts'

export { CHAPTERS, chapterAddress, HOW_HOME } from './frame.ts'

/** Each chapter's body, by its slug in CHAPTERS. */
const BODIES: Readonly<Record<string, string>> = {
  '': ONE_PICTURE,
  'adding-a-friend': ADDING_A_FRIEND,
  'private-rooms': PRIVATE_ROOMS,
  'your-devices': YOUR_DEVICES,
  'recovery-key': RECOVERY_KEY,
  'saving-your-data': SAVING_YOUR_DATA,
  'coming-soon': COMING_SOON,
}

export const HOW_PAGES: ReadonlyMap<string, HelpPage> = new Map(
  CHAPTERS.map((chapter) => [
    chapterAddress(chapter.slug),
    chapterPage(chapter.slug, BODIES[chapter.slug] ?? ''),
  ]),
)
