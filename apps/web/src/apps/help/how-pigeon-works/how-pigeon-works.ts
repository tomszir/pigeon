// "How Pigeon Works": the hand-written half of Help, for people.

import type { Child } from '@pigeon/pigeonhtml/jsx-runtime'
import type { HelpPage } from '../page/page.pigeon.tsx'
import { ADDING_A_FRIEND } from './adding-a-friend.pigeon.tsx'
import { COMING_SOON } from './coming-soon.pigeon.tsx'
import { CHAPTERS, chapterAddress, chapterPage } from './frame.pigeon.tsx'
import { ONE_PICTURE } from './one-picture.pigeon.tsx'
import { PRIVATE_ROOMS } from './private-rooms.pigeon.tsx'
import { RECOVERY_KEY } from './recovery-key.pigeon.tsx'
import { SAVING_YOUR_DATA } from './saving-your-data.pigeon.tsx'
import { YOUR_DEVICES } from './your-devices.pigeon.tsx'

/** Each chapter's body, by its slug in CHAPTERS. */
const BODIES: Readonly<Record<string, Child>> = {
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
