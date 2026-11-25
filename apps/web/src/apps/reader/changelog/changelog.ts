// Changelog.txt: release notes for the people using Pigeon, newest first. The
// author writes them on each release PR, from a draft scripts/release-notes.ts makes.
import text from './changelog.txt?raw'

export const CHANGELOG_TEXT = text

/** Each section opens "0.4.0, 24 November 2026". */
const HEADING = /^(\d+\.\d+\.\d+), /gm

/** The versions the notes cover, newest first. */
export function versionsIn(notes: string): string[] {
  return [...notes.matchAll(HEADING)].map((match) => match[1] ?? '')
}
