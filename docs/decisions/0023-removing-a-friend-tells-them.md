# 0023: Removing a friend tells them

Removing a friend sends them a signed `unfriend`, so their Pigeon stops talking to you and says so, rather than you going quiet.

- Status: accepted
- Date: 2026-11-24

## Context

The friend menu adds Remove Friend. The era's messengers removed silently: to the other side you just looked offline forever. In Pigeon that would leave their messages queued for you in their log, unanswered, and their Pigeon trying your pair room on every visit, with no way for them to know.

## Decision

- Remove deletes the friend and the chat from this browser and sends `unfriend` in the pair room. If they're offline, their id waits in `farewells` and is told the next time they're online, then dropped.
- Their side keeps the chat read-only with a last line, "Rook removed you as a friend on ...", shows them as "(removed you)", and stops its session. Removing you back deletes it. Pairing again later makes you friends once more.
- Blocking is local: their id goes in `blocked`, your invites don't answer them, and their invites are refused. They aren't told they're blocked, only that they were removed.

## Consequences

Both sides agree on who is a friend, and nothing waits forever for someone who left. Someone who removes you can't do it quietly; the maintainer chose that over the era's habit. A farewell that never arrives (they never come back) costs one pending id and a room joined on each visit.
