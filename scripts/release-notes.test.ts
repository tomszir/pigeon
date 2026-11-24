import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bullet, draftNotes, findSection, formatDate, noteFor } from './release-notes.ts'

const NOTES = `    PIGEON  WHAT'S NEW
==============================================

0.4.0, 24 November 2026
----------------------------------------------
  * Every friend has a menu.
`
const DATE = new Date('2026-12-02T10:00:00Z')

describe('noteFor', () => {
  it('turns a feat, fix or perf summary into a sentence', () => {
    assert.equal(
      noteFor('feat(messenger): give each friend a menu to rename, mute or remove (#22)'),
      'Give each friend a menu to rename, mute or remove.',
    )
    assert.equal(noteFor('fix: keep the menu open!'), 'Keep the menu open!')
    assert.equal(noteFor('perf(core)!: sync chats faster'), 'Sync chats faster.')
  })

  it('leaves out what people would not notice', () => {
    for (const subject of ['chore: release 0.4.0 (#21)', 'docs: plan M12', 'ci: cache pnpm'])
      assert.equal(noteFor(subject), undefined)
  })
})

describe('bullet', () => {
  it('wraps to 46 columns under its star', () => {
    const text = bullet(
      'Adding a friend shows each step as it happens: reaching the relays and asking who they are.',
    )
    const lines = text.split('\n')
    assert.ok(lines.every((line) => line.length <= 46))
    assert.match(lines[0] ?? '', /^ {2}\* Adding/)
    assert.ok(lines.slice(1).every((line) => line.startsWith('    ') && line[4] !== ' '))
  })
})

describe('formatDate', () => {
  it('writes the day, month and year', () =>
    assert.equal(formatDate(new Date('2026-11-24T23:30:00Z')), '24 November 2026'))
})

describe('draftNotes', () => {
  it('adds a section for the new version above the last one', () => {
    const notes = draftNotes({
      notes: NOTES,
      version: '0.5.0',
      date: DATE,
      subjects: ['feat(messenger): draw a bird for each friend (#30)', 'ci: speed up the build'],
    })
    const section = findSection(notes, '0.5.0')?.text
    assert.equal(
      section,
      ['0.5.0, 2 December 2026', '-'.repeat(46), '  * Draw a bird for each friend.'].join('\n'),
    )
    assert.ok(notes.indexOf('0.5.0,') < notes.indexOf('0.4.0,'))
    assert.ok(notes.includes('\n\n0.4.0, 24 November 2026'))
  })

  it('leaves notes that already cover the version alone', () =>
    assert.equal(draftNotes({ notes: NOTES, version: '0.4.0', date: DATE, subjects: [] }), NOTES))

  it('keeps what was written on the release PR and adds only newer commits', () => {
    const previous = draftNotes({
      notes: NOTES,
      version: '0.5.0',
      date: new Date('2026-11-30T10:00:00Z'),
      subjects: [],
    }).replace('  * Small fixes and improvements.', '  * Every friend has their own bird now.')
    const notes = draftNotes({
      notes: NOTES,
      previous,
      version: '0.5.0',
      date: DATE,
      subjects: ['fix(shell): stop the clock running fast (#31)'],
    })
    assert.equal(
      findSection(notes, '0.5.0')?.text,
      [
        '0.5.0, 2 December 2026',
        '-'.repeat(46),
        '  * Every friend has their own bird now.',
        '  * Stop the clock running fast.',
      ].join('\n'),
    )
  })

  it('says something when no commit is worth a line', () =>
    assert.match(
      draftNotes({ notes: NOTES, version: '0.4.1', date: DATE, subjects: ['docs: tidy'] }),
      /0\.4\.1, 2 December 2026\n-+\n {2}\* Small fixes and improvements\./,
    ))
})
