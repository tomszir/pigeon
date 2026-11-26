// Every page that comes with Pigeon, as the sets Explorer looks an address up in, in order: the
// start page, then Help. One list, so what Explorer serves and what the test over every bundled
// page checks can't differ.

import { type LocalPages, START_PAGES } from '../apps/explorer/local-pages/local-pages.ts'
import { HELP_PAGES } from '../apps/help/help-pages/help-pages.pigeon.tsx'

export const BUNDLED_PAGES: readonly LocalPages[] = [START_PAGES, HELP_PAGES]
