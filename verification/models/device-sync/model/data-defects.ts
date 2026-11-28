// The your-data model's planted defects: each turns one rule off (sometimes two, where another rule
// would cover for it) in one scenario, and names the invariant that must catch it.
import { SCENARIOS } from './data-model.ts'
import type { DataConfig, DataRules } from './data-state.ts'

export interface Defect {
  readonly name: string
  readonly what: string
  readonly scenario: string
  readonly rule: keyof DataRules
  /** A second rule turned off with it, where another rule would otherwise cover for this one. */
  readonly also?: keyof DataRules
  /** The invariant that must catch it. */
  readonly caughtBy: string
}

/** Planted defects: each turns one rule off, and names the invariant that must catch it. */
export const DEFECTS: readonly Defect[] = [
  {
    name: 'missing tombstone',
    what: 'unfriending drops the friend on that device only, leaving no tombstone',
    scenario: 'friends',
    rule: 'tombstones',
    caughtBy: 'T1 an ended friendship stays ended',
  },
  {
    name: 'secret per friend, not per friendship',
    what: 'pair-secret state is kept per friend, so pairing again leaves other devices on the dead secret',
    scenario: 'repair',
    rule: 'secretPerIncarnation',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'last writer by arrival',
    what: 'a register takes whatever arrived last, so a device back from days away wins',
    scenario: 'settings',
    rule: 'stampOrder',
    caughtBy: 'W1 the newest change wins',
  },
  {
    name: 'stamps refused when ahead',
    what: 'an entry stamped further ahead than the receiving clock allows is refused',
    scenario: 'skew',
    rule: 'acceptAhead',
    caughtBy: 'C1 devices on the list converge',
  },
  {
    name: 'sealed to every device ever known',
    what: 'letters, pair secrets in them included, are sealed to removed devices too',
    scenario: 'removal',
    rule: 'sealToList',
    caughtBy: 'P2 no new secret to a removed device',
  },
  {
    name: 'secret without the log',
    what: 'a letter carrying a new pair secret doesn\u2019t carry the device log that removed X',
    scenario: 'removal',
    rule: 'logFirst',
    caughtBy: 'P4 secret holders know the removal',
  },
  {
    name: 'secret by the highest round',
    what: 'a device takes whichever proposal claims the highest round, counted or not',
    scenario: 'removal',
    rule: 'chainRules',
    caughtBy: 'P6 a removed device\u2019s proposal never wins once heard',
  },
  {
    name: 'secret state dropped at a tombstone',
    what: 'a tombstone drops its friendship\u2019s secret state, lost for good if the tombstone stops counting (with the removal stamped by the writer\u2019s clock alone, so it can)',
    scenario: 'removal',
    rule: 'keepEndedSecrets',
    also: 'removalAfterHeld',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'the friend not told',
    what: 'a device whose secret changes through your devices doesn\u2019t send it to the friend',
    scenario: 'removal',
    rule: 'tellFriend',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'any first secret counts, the first held kept',
    what: 'a removed device\u2019s second first secret, taken before the writer\u2019s own, is kept for good',
    scenario: 'roots',
    rule: 'rootRules',
    caughtBy: 'P5 no friendship on a removed device\u2019s secret',
  },
  {
    name: 'only friendships live at the removal renewed',
    what: 'a friendship paired in the window before every device heard keeps a secret the removed device read',
    scenario: 'window',
    rule: 'renewLearned',
    caughtBy: 'P2b no friendship on a secret a removed device read',
  },
  {
    name: 'the friend\u2019s earlier proposal kept',
    what: 'the friend\u2019s proposal made in the window beats the writer\u2019s renewal, and nothing renews from it',
    scenario: 'friendround',
    rule: 'renewRivals',
    caughtBy: 'P2b no friendship on a secret a removed device read',
  },
  {
    name: 'renewal by time, never ending',
    what: 'each writer renews unless it proposed the secret after its removal, by time; both sides do',
    scenario: 'mutual',
    rule: 'renewByKnowledge',
    caughtBy: 'S0 settling ends',
  },
  {
    name: 'renewal by time, with a fast clock',
    what: 'the writer renews until its own clock passes the removal\u2019s stamp, once per check',
    scenario: 'skewremoval',
    rule: 'renewByKnowledge',
    caughtBy: 'S1 renewals are bounded',
  },
  {
    name: 'the friend not forwarding',
    what: 'a friend whose secret changes keeps it to itself, so a removed device mailing it splits the friendship',
    scenario: 'roots',
    rule: 'friendForwards',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'a relay without the other side\u2019s log',
    what: 'the friend\u2019s devices pass a chain between themselves without your log, so a stale copy of your list seals it to X',
    scenario: 'relay',
    rule: 'relayCarriesLogs',
    caughtBy: 'P2 no new secret to a removed device',
  },
  {
    name: 'the friend taking a removed device\u2019s letters',
    what: 'a friend that knows of the removal still takes a forged first secret from the removed device',
    scenario: 'roots',
    rule: 'friendRefuses',
    caughtBy: 'R5 a friend takes nothing from a removed device once it knows',
  },
  {
    name: 'the friend counting a removed device\u2019s replacement',
    what: 'a friend that knows of the removal still counts the removed device\u2019s proposal',
    scenario: 'removal',
    rule: 'friendDiscounts',
    caughtBy: 'P5 no friendship on a removed device\u2019s secret',
  },
  {
    name: 'a removed device\u2019s first secret trusted by its marker',
    what: 'the writer renews a removed device\u2019s backdated first secret only if its marker lacks the removal, and the marker says it knew',
    scenario: 'roots',
    rule: 'renewRemovedOwn',
    caughtBy: 'P5 no friendship on a removed device\u2019s secret',
  },
  {
    name: 'a threshold friends never see',
    what: 'friends judge a removed device\u2019s first secret by the removal\u2019s clock time, your devices by a later threshold',
    scenario: 'skewpair',
    rule: 'thresholdInLog',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'a threshold friends never see, gamed',
    what: 'as above, with the removed device raising the threshold and forging a first secret between the two',
    scenario: 'hostilepair',
    rule: 'thresholdInLog',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'summaries by the highest unbroken number',
    what: 'a gap a removed device left makes every exchange send its entries again, for ever',
    scenario: 'gap',
    rule: 'summaryHighestHeld',
    caughtBy: 'S0 settling ends',
  },
  {
    name: 'stamps past entries that no longer count',
    what: 'a discounted entry at the cap pushes later changes to the cap, where they tie',
    scenario: 'capped',
    rule: 'stampFollowsCounting',
    caughtBy: 'W2 a change made after seeing another beats it',
  },
  {
    name: 'a re-pair race settled by the friendship each device paired',
    what: 'each device keeps the friendship it paired and ends the other, so two devices end both',
    scenario: 'race',
    rule: 'repairSeenByDevice',
    caughtBy: 'T4 a re-pair race keeps the friend\u2019s friendship',
  },
  {
    name: 'kind names looked up through the prototype',
    what: 'fold looks a kind\u2019s reader up without checking its table owns the name, and calling what `__proto__` finds throws',
    scenario: 'kinds',
    rule: 'kindsOwnOnly',
    caughtBy: 'C2 fold never fails',
  },
  {
    name: 'two re-pairings left as they are',
    what: 'two friendships with one friend stay live, and devices end on the one the friend isn\u2019t in',
    scenario: 'race',
    rule: 'settleRepairs',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'removal stamped by the writer\u2019s clock alone',
    what: 'what a fast-clocked device delivered before its removal stops counting',
    scenario: 'skewremoval',
    rule: 'removalAfterHeld',
    caughtBy: 'W1 the newest change wins',
  },
  {
    name: 'removal stamped past every entry held',
    what: 'an entry above the cap pushes the removal past what any device log takes',
    scenario: 'overcap',
    rule: 'removalWithinCap',
    caughtBy: 'R6 a removal can always be made',
  },
  {
    name: 'the per-author cap on entries held',
    what: 'devices refuse different numbers at the cap, so the one behind is sent what it refuses for ever',
    scenario: 'flood',
    rule: 'capByNumber',
    caughtBy: 'S0 settling ends',
  },
  {
    name: 'removed device not discounted',
    what: 'entries a removed device stamped after its removal still count',
    scenario: 'removal',
    rule: 'discountRemoved',
    caughtBy: 'R2 removed device discounted from its removal',
  },
  {
    name: 'letters from a removed device taken',
    what: 'a letter counts whoever sent it',
    scenario: 'removal',
    rule: 'senderOnList',
    caughtBy: 'R1 nothing from a removed device once all know',
  },
  {
    name: 'summaries without a digest',
    what: 'a summary says only how far each author goes, so two entries under one number never cross',
    scenario: 'room',
    rule: 'forkDigest',
    caughtBy: 'C1 devices on the list converge',
  },
  {
    name: 'same sealed letter put again',
    what: 'a lost letter is put again as first sealed: to a device removed since, not to one linked since',
    scenario: 'link',
    rule: 'resealOnReput',
    caughtBy: 'P1 sealed to the list',
  },
  {
    name: 'letters outside the outbox',
    what: 'a new pair secret or a change is sent without the outbox, and a closed tab loses it',
    scenario: 'outbox',
    rule: 'outbox',
    caughtBy: 'P3 one pair secret per friend',
  },
  {
    name: 'one unreadable entry refuses the letter',
    what: 'a letter holding an entry this Pigeon can\u2019t read is refused whole',
    scenario: 'newer',
    rule: 'perEntry',
    caughtBy: 'C1 devices on the list converge',
  },
]

export function withDefect(defect: Defect): DataConfig {
  const base = SCENARIOS[defect.scenario]
  if (!base) throw new Error(`no scenario ${defect.scenario}`)
  return {
    ...base,
    name: `${base.name} [defect: ${defect.name}]`,
    rules: {
      ...base.rules,
      [defect.rule]: false,
      ...(defect.also ? { [defect.also]: false } : {}),
    },
  }
}
