# 0045: Lighthouses someone else names

Pigeon connects to a Lighthouse someone else named only at a public `wss://` address, and not at all while relay-only is on; Lighthouses you chose are always reached.

- Status: accepted
- Date: 2026-11-26

## Context

Mail goes to the recipient's Lighthouses ([0037](0037-the-lighthouse-and-its-mailbox.md), [0039](0039-messages-through-lighthouses.md)): a friend says theirs in `hello`, an invite link can name one in `?l=`, a link's card and a request through it carry more. Pigeon took them as they came. Connecting to a Lighthouse shows it your IP address, so a friend could run one, name it, stay offline, and learn your IP from your next message, even with Always Go Through the Relay on, whose point is that friends never see it. An address was any `wss://` host, private ones included, or `ws://localhost`, so a friend could also point your browser's WebSockets at services on your own network or computer.

Pigeon needs the recipient's Lighthouse to leave them mail, so refusing every Lighthouse you didn't choose would stop letters to most friends. Warning before each letter was the other way the problem could be closed, but a warning someone has to read every time is soon clicked through, and relay-only is already the setting that says you don't want your IP seen.

## Decision

- **Lighthouses you chose** are on your list, on the list your other devices last said, or official (Pigeon's own, run by whoever runs the relay). They're always reached, at any address, `ws://localhost` and private ones included.
- **Any other** is reached only when its URL is `wss://` to a public host, and never while relay-only is on. Private, loopback, link-local, shared, multicast and other special-use addresses (IANA's special-purpose registries, IPv4 and IPv6), `localhost`, single-label names and names under network-only suffixes aren't public. An IPv4 host is read with the URL standard's IPv4 parser, as a browser reads it, so `127.1` can't pass for a name.
- **Same Lighthouse** means exactly the same URL. Matching the host alone was weighed and refused: a host that sends paths to different backends (path hosting, a reverse proxy) would pass your IP to someone else's service behind it. A friend writing your Lighthouse's URL differently is refused with relay-only on, which fails closed.
- **Checked where connections are made.** Checking a Lighthouse in Network, one on your list or one you're adding, is the one call that skips it: you're choosing that one. Every other Lighthouse request goes through one check, made at the time of the request, so it covers mail, receipts, invite links and whatever comes later, and turning relay-only on stops connections already made from being used again. Mail for a friend with no Lighthouse Pigeon may reach isn't sealed for them: it waits until you meet, and the chat says it waits until they're online. The relay setting says that mail goes only to Lighthouses you chose.
- **The check is Pigeon's own code** in `@pigeon/core`, which has no URL parser or browser APIs: a short IPv4 and IPv6 reader and a table of special-use ranges, with tests for each form, rather than a new dependency.

## Consequences

With relay-only on, nobody but Lighthouses you chose and the relay sees your IP, and a friend whose Lighthouses are all their own gets your messages only when you're both online; your receipts for their letters don't reach them either, so their chat shows a letter left, not had, until you meet. Without it, a friend's public Lighthouse sees your IP, as the friend would over a direct connection anyway. A Lighthouse at home on a private address works for you, and for friends who added it to their own list, not for friends who only hear of it. A name whose DNS answers with a private address isn't caught here. Only some browsers check that themselves (recent Chrome does, Firefox and Safari don't for WebSockets), so with relay-only off a friend can still aim a `wss://` connection at your network that way; it opens with TLS, so a service there sees a TLS handshake and never a WebSocket frame. Resolving names first isn't something a page can do.
