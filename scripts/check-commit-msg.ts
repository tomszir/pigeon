// Usage:
//   node scripts/check-commit-msg.ts <message-file>   (git commit-msg hook)
//   TITLE=… BODY=… node scripts/check-commit-msg.ts   (CI, for a PR)
// CI passes the PR text through environment variables, never through the shell, so a crafted
// title can't run commands.
import { readFileSync } from 'node:fs'
import { checkAttribution, checkCommitMessage, checkHeader } from './commit-message.ts'

const file = process.argv[2]
const errors = file
  ? checkCommitMessage(readFileSync(file, 'utf8'))
  : [
      ...checkHeader((process.env['TITLE'] ?? '').trim()),
      ...checkAttribution(`${process.env['TITLE'] ?? ''}\n${process.env['BODY'] ?? ''}`),
    ]

if (errors.length > 0) {
  console.error(`✗ ${errors.join('\n✗ ')}`)
  console.error('See CONTRIBUTING.md for the commit format.')
  process.exit(1)
}
