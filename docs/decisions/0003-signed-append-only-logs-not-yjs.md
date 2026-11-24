# 0003: Signed append-only logs, not Yjs

Shared state (chats, guestbooks, receipts) is a set of per-author signed append-only logs written in `@pigeon/core`, not a CRDT library.

- Status: accepted
- Date: 2026-11-24

## Context

Everything Pigeon shares is append-only: messages, guestbook entries, letter receipts. A general CRDT (Yjs) solves concurrent editing of rich structures, which Pigeon doesn't need, and adds a dependency the author's projects usually avoid.

## Decision

Each author appends signed entries with a sequence number and a Lamport timestamp. Peers exchange per-author "highest sequence I have" summaries and send what's missing. A view is the sorted union of entries; deletions and edits are new entries that refer to old ones.

## Consequences

Small, pure, fully testable code with no dependency, and a good story to explain. Verifying signatures gives authenticity for free. Concurrent editing of one document (for example, two people editing a page) is not supported; pages are edited only by their owner. If that changes, revisit with a new decision.
