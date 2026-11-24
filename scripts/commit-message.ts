// Conventional Commits and no AI attribution, for the commit-msg hook and the pr-title CI job.
// Adapted from the author's Aloft project. CONTRIBUTING.md describes the format.
export const TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const

const MAX_HEADER = 72
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9-]*\\))?(!)?: (.+)$`)

// Only AI tools: tooling such as release-please legitimately says "generated
// with" in its PR bodies.
const AI_TOOLS = 'claude|anthropic|copilot|chatgpt|openai|gemini|cursor|codex|devin'
const AI_ATTRIBUTION: readonly [RegExp, string][] = [
  [new RegExp(`^co-authored-by:.*(${AI_TOOLS})`, 'im'), 'AI Co-Authored-By trailer'],
  [
    new RegExp(`generated (with|by|using)\\b.*\\b(${AI_TOOLS}|ai)\\b`, 'i'),
    'AI "generated with" line',
  ],
  [/\u{1F916}/u, 'robot emoji signature'],
]

// Git's own messages for local work; they never reach main because PRs are
// squash-merged under the PR title.
const GIT_GENERATED = /^(fixup!|squash!|amend!|Merge |Revert ")/

export function checkHeader(header: string): string[] {
  if (GIT_GENERATED.test(header)) return []
  const match = HEADER.exec(header)
  if (!match) {
    return [
      `"${header}" is not a conventional commit: use type(scope): summary, type one of ${TYPES.join(', ')}`,
    ]
  }
  const errors: string[] = []
  const summary = match[4] ?? ''
  if (header.length > MAX_HEADER)
    errors.push(`header is ${header.length} characters; keep it to ${MAX_HEADER}`)
  if (/^[A-Z][a-z]/.test(summary)) errors.push('start the summary lowercase')
  if (/\.$/.test(summary)) errors.push('drop the trailing period')
  return errors
}

export function checkAttribution(text: string): string[] {
  return AI_ATTRIBUTION.flatMap(([pattern, what]) =>
    pattern.test(text) ? [`remove the ${what}`] : [],
  )
}

/** A whole commit message as git hands it to the commit-msg hook. */
export function checkCommitMessage(message: string): string[] {
  const lines = message.split('\n').filter((line) => !line.startsWith('#'))
  const header = lines.find((line) => line.trim() !== '')?.trimEnd() ?? ''
  if (header === '') return ['the commit message is empty']
  return [...checkHeader(header), ...checkAttribution(lines.join('\n'))]
}
