// Drafts Changelog.txt's section for the version on a release PR, from the
// feat, fix and perf summaries since the last release. The maintainer rewrites it for people before
// merging; this only saves them a blank page.
//
// Usage, on the release PR's branch (the release-please workflow runs it):
//   node scripts/release-notes.ts [<previous head of the release PR's branch>]
// With a previous head, the section written there is kept and only commits since are added, so
// edits survive release-please rebuilding its branch.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

export const CHANGELOG = 'apps/web/src/apps/reader/changelog/changelog.txt'
const WIDTH = 46
const RULE = '-'.repeat(WIDTH)
const HEADING = /^(\d+\.\d+\.\d+), .*$/gm
const NOTEWORTHY = /^(feat|fix|perf)(\([a-z0-9][a-z0-9-]*\))?!?: (.+)$/
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "24 November 2026", in UTC so the runner's time zone doesn't matter. */
export function formatDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** A commit summary as a sentence, or nothing for commits people wouldn't notice. */
export function noteFor(subject: string): string | undefined {
  const summary = NOTEWORTHY.exec(subject.trim())?.[3]
  if (summary === undefined) return undefined
  const text = summary.replace(/\s*\(#\d+\)$/, '').trim()
  if (text === '') return undefined
  return `${text[0]?.toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`
}

/** One bullet, wrapped to the reader's 46 columns. */
export function bullet(text: string): string {
  const lines: string[] = []
  let line = '  *'
  for (const word of text.split(/\s+/)) {
    if (line.length + 1 + word.length > WIDTH && line.trim() !== '*' && line.trim() !== '') {
      lines.push(line)
      line = '   '
    }
    line = `${line} ${word}`
  }
  lines.push(line)
  return lines.join('\n')
}

interface Section {
  readonly start: number
  readonly end: number
  readonly text: string
}

/** Where `version`'s section is in `notes`: its heading to the next heading, blank lines off. */
export function findSection(notes: string, version: string): Section | undefined {
  const headings = [...notes.matchAll(HEADING)]
  const index = headings.findIndex((match) => match[1] === version)
  const heading = headings[index]
  if (heading === undefined) return undefined
  const start = heading.index
  const end = headings[index + 1]?.index ?? notes.length
  return { start, end, text: notes.slice(start, end).trimEnd() }
}

export interface DraftInput {
  /** Changelog.txt as it is on the branch. */
  readonly notes: string
  /** Changelog.txt as it was at the release PR's previous head, if it had one. */
  readonly previous?: string | undefined
  readonly version: string
  readonly date: Date
  /** Commit summaries since the last release, or since the previous head when there is one. */
  readonly subjects: readonly string[]
}

/** Changelog.txt with a section for `version` at the top. */
export function draftNotes(input: DraftInput): string {
  const { notes, version } = input
  if (findSection(notes, version) !== undefined) return notes

  const heading = `${version}, ${formatDate(input.date)}`
  const kept = input.previous === undefined ? undefined : findSection(input.previous, version)
  const body = kept?.text.split('\n').slice(2).join('\n') ?? ''
  const fresh = input.subjects
    .map(noteFor)
    .filter((note): note is string => note !== undefined)
    .map(bullet)
    .filter((line) => !body.includes(line))
  const bullets = [body, ...fresh].filter((part) => part !== '')
  if (bullets.length === 0) bullets.push(bullet('Small fixes and improvements.'))
  const section = [heading, RULE, ...bullets].join('\n')

  const first = notes.match(HEADING)?.[0]
  if (first === undefined) return `${notes.trimEnd()}\n\n${section}\n`
  const at = notes.indexOf(first)
  return `${notes.slice(0, at)}${section}\n\n${notes.slice(at)}`
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const subjectsIn = (range: string) =>
  git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean)

function main(previousHead: string | undefined): void {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
  const notes = readFileSync(CHANGELOG, 'utf8')
  let previous: string | undefined
  let subjects: string[]
  if (previousHead) {
    try {
      previous = git('show', `${previousHead}:${CHANGELOG}`)
    } catch {
      previous = undefined
    }
  }
  if (previous !== undefined && previousHead && findSection(previous, version) !== undefined) {
    // The previous head sat on main as it was then; only commits after that are new.
    subjects = subjectsIn(`${git('merge-base', previousHead, 'HEAD')}..HEAD`)
  } else {
    subjects = subjectsIn(`${git('describe', '--tags', '--abbrev=0', 'HEAD^')}..HEAD`)
  }
  writeFileSync(CHANGELOG, draftNotes({ notes, previous, version, date: new Date(), subjects }))
}

if (import.meta.main) main(process.argv[2])
