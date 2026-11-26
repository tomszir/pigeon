# 0059: File size limits that only go down

Biome refuses a source file over 600 lines and a test file over 1,000, and every file already over gets its own higher limit that is lowered as the file is split.

- Status: accepted
- Date: 2026-11-26

## Context

Many agents change Pigeon at once, each in the file closest to hand. Nothing stopped a file from growing: `messenger/service/service.ts` is over 3,000 lines and its test file over 4,400, and a file that size is slow to read, collides with every parallel change, and is rarely split by anyone who only came to fix something in it.

Biome's `style/noExcessiveLinesPerFile` counts a file's lines, blank ones included (its `skipBlankLines` option is off). Its count can sit a little under `wc -l`, so the limits are set from Biome's own report.

## Decision

- **One limit for source, one for tests.** 600 lines for a source file, 1,000 for a `*.test.ts`, `*.test.tsx` or Playwright `*.spec.ts` file, which holds many small cases under one `describe`. Blank lines count.
- **Files already over get a per-file override.** Each is set to its size when the rule went in, rounded up to the next 100, in its own `biome.json` override. They can't grow past that. When a file is split, its number is lowered to match, or the override removed once it is under the limit.
- **No function-length rule.** A factory such as `createMessenger` is one long closure on purpose, and a Solid component is a long function of markup. A length limit there would push code into helpers that share state through parameters and read worse. The file limit is what keeps those closures from collecting everything.

## Consequences

A change that pushes a file past its limit fails `biome check`, so the person making it splits the file or says why the limit moves, in the diff, where review sees it. Splitting a file is still a choice made by someone who knows the code; the rule only stops it being put off silently. Ruled out: a function-length rule (above), a limit that skips blank lines (a file could be padded with the pieces it should be split into without anyone seeing it grow), and a ratchet script that reads the limits from a file of its own (Biome's overrides already do that, in the config people read).
