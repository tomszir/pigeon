# 0055: Waiting for mail at a Lighthouse

A connected Pigeon can ask a Lighthouse to answer one held request as soon as something is put under tags it names, so mail between people who are both connected arrives in seconds, while the mail check stays the only way mail is fetched.

- Status: accepted; amended by ADR-0063 (removed): waits count against their range by tags rather than by connections, waits heard from alone count, and a Pigeon waits only after a look that read its Lighthouse to the end. Not built yet; docs/lighthouse.md, docs/protocol.md and docs/threat-model.md change with the code
- Date: 2026-11-26

## Context

A Lighthouse answers `put`, `list`, `list-claimed`, `get` and `drop`, nothing more ([0037](0037-the-lighthouse-and-its-mailbox.md)). A Pigeon finds its mail by looking: when it starts, every 10 minutes, when you come back to it, and 10 seconds after you send. So a letter ([0039](0039-messages-through-lighthouses.md)) put one second after a look waits up to ten minutes, even when its recipient is connected to that same Lighthouse the whole time. Your own devices, and friends who are both open but not meeting in a pair room, are as slow as the look (#144).

Every look already sends the Lighthouse the full set of tags it fetches under, yesterday's and today's for every friend, your own and any invite's, in one request from one address. So a Lighthouse already sees which tags belong together and that the same address comes back. Being told at once adds timing, not tags: the Lighthouse knows to the second while a Pigeon is open, and sees mail fetched moments after it's put.

The official Worker Lighthouse is one Durable Object holding every socket, and its sockets hibernate. It's evicted about 10 seconds after it goes quiet, and the put that should wake a waiting Pigeon is what wakes the object, so anything held only in its JavaScript memory is gone just when it's needed. Cloudflare's documentation gives the limits this design is sized to:

- A hibernating socket's attachment holds up to 16,384 bytes, kept while the connection stays up ([WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
- An isolate has 128 MB of memory, shared by the objects of a class it hosts and the Worker's own code ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [metrics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)).
- One object takes at most 32,768 hibernatable WebSockets, and often fewer in practice ([WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
- Timers, alarms and requests keep an object from hibernating ([lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)).
- A WebSocket auto-response is answered by the runtime without waking the object, and isn't billed ([state](https://developers.cloudflare.com/durable-objects/api/state/), [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).

## Decision

### The request

- **`wait { tags, cursor, seconds }`**, a new request type:
  - `tags`: 1 to 128 distinct mail keys, the same 32-byte tags `list` takes, exact, never a prefix.
  - `cursor`: a `list` cursor.
  - `seconds`: the lease, 1 to 600.
- **One answer, `waited { why }`,** signed like every reply over the connection's nonce and the hash of that `wait` frame. `why` is `mail` when something was put under one of its tags after its cursor. It's `lease` when the wait ended without mail: its lease ran out, or a new `wait` on the connection replaced it. The answer names no tag, id or size.
- **A `wait` counts as a read,** like `list`. A shape it can't take is `malformed`, and one past the limits below is `limit`.
- **No new protocol number.** `wait` is a new request type, as `list-claimed` was: an older Lighthouse calls it `malformed`. It isn't a field on `list`, which an older Lighthouse would ignore and answer at once, so the client couldn't tell "nothing yet" from "doesn't wait".

### What a Lighthouse does

- **One wait per connection.** A new `wait` first ends the one standing, answering it `waited { lease }`.
- **Answered at once if there's mail.** A wait whose tags already hold a blob past its cursor that hasn't expired is answered `waited { mail }` at once. The cursor is the one the client's last look saved, which closes the gap between a look ending and its wait starting.
- **Otherwise held**, until the first of these:
  - **A put stores a new blob under one of its tags.** The wait is answered `waited { mail }`. A retry of a blob already held stores nothing and wakes nobody.
  - **Its lease ends.** It's answered `waited { lease }`. Node answers at the lease's end. The Worker answers when it next notices, on the socket's next frame, its next wake or its hourly alarm, never by a timer, since a timer would keep it from hibernating. A put never wakes a wait whose lease has passed.
  - **The socket closes.** The wait is gone, with no answer.
- **A put doesn't depend on waits.** Its reply, and whether it succeeds, are worked out without looking at any wait. The reply is sent before any wait it wakes is answered, so signing those answers can't delay it.
- **A put never wakes a wait on the connection that put it,** so your device putting a copy for your other devices, or a receipt, doesn't wake itself.
- **Keepalives.** A connection with a wait standing sends the text frame `ping` about every 50 seconds, and the Lighthouse answers `pong`. Neither is signed or a request. The Worker answers through the runtime's auto-response, without waking. Node answers itself, counting it as a frame. A connection with a wait standing that keeps sending keepalives isn't closed as idle.
- **The Worker keeps each standing wait in its socket's attachment,** beside the address and nonce already there: its request number, its frame's hash, its tags, cursor and lease end. 128 tags take about 7 KB of the attachment's 16 KB. Its index from tag to waiting sockets lives in memory and is rebuilt from the attachments when the object wakes. Waits are never written to the object's SQLite, so a connection's tag set is never written down.

### Limits

- **New limits:**
  - `waitingPerRange` (16): connections with a wait standing, per IPv4 address or IPv6 /64.
  - `waitingPer48` (64): the same, per IPv6 /48.
  - `maxWaitedTags` (200,000): tags in all standing waits together. It bounds the index's memory; on the Worker, a million entries would take most of an isolate's 128 MB.
  - Past any of them a new `wait` gets `limit`, and its Pigeon looks on its schedule.
- **The Worker's `maxConnections` rises to 30,000,** under the 32,768 a Durable Object takes: sleeping sockets cost it nothing, and with waits each open Pigeon keeps its connection. The Node Lighthouse keeps 10,000.
- **Waiting connections can be evicted.** When a new connection finds no room, idle connections are closed first, as now, and then the connection whose wait has stood longest among those counted against the full limit. A Pigeon that loses its wait falls back to its schedule and waits again after its next look.

### What a Pigeon does

- **Where.** It waits only at Lighthouses on its own list, never at one a friend or a link named. It doesn't wait while Always Go Through the Relay is on, or when "Hear about mail at once" is off in Settings, under Connection. The switch is on by default.
- **When.** After each look, at each Lighthouse that answered it, it sends a `wait` with:
  - the tags a sender could be putting under now: its self secret's, each friend's pair secret's, and an invite's ask and answer tags while the invite waits. That's today's, yesterday's in the first two hours of the UTC day, and tomorrow's in the last two;
  - the cursor that look saved;
  - a lease that runs to its next scheduled look, at most 600 seconds.
    Past 128 tags it keeps its own and its invites' tags and those of the friends it heard from most recently, and the schedule covers the rest.
- **On `waited { mail }`:** it waits a random 0 to 2 seconds, so a network observer can't as easily line up the put with the fetch, then asks for a look through the usual scheduler (never within 5 seconds of the last, one at a time).
- **On `waited { lease }`:** nothing. The next look waits again.
- **The wait is only a cue.** It never moves the cursor, opens, takes or drops anything. Only the look does. The 10-minute schedule stays as it is.
- **The wait doesn't time out** like other requests, whose answer is expected within 15 seconds. It ends when it's answered, when a new one replaces it, or when the connection closes.
- **`malformed`** means this Lighthouse doesn't wait. The Pigeon doesn't ask again on that connection, and tries again on its next one.
- **A connection that closes while it waits** is opened again, and the wait sent again, only while Pigeon is on screen, after 5 seconds and doubling up to 5 minutes. Otherwise the next look opens it.

### What a Lighthouse learns

Said on the privacy page in Read Me, in docs/lighthouse.md and in docs/threat-model.md:

- No tag it doesn't already see. A wait names a subset of the tags the look before it listed.
- While Pigeon is open and waiting: that it's open, to the second; which tags that connection waits on, and for how long; and that mail put under them is fetched moments later. In memory, beside the connection's address, for as long as it waits.
- Someone who isn't the Lighthouse but watches the network, an internet provider or Cloudflare for the Worker, can line up a frame into the Lighthouse with one out to another person a moment later. The random delay blurs that, and doesn't hide it.
- Anyone who knows one of your tags can already `list` it as often as the limits allow. A wait makes watching it cheap, and a put that's fetched within seconds tells them you're open now. The tag holders are your friends, your devices, a device removed before secrets are replaced, and whoever holds an invite link, for its ask tags.

### What the model checks

Before any code, the verification track writes the wait's state machine from this record and the docs, with a model-based test the implementation must pass. Its invariants:

- **One reply.** Each `wait` gets exactly one `waited`, or none if the connection closes first, signed over that connection's nonce and that frame's hash.
- **Never lost silently.** While a wait stands and its connection stays open, a new blob put under one of its tags past its cursor, by another connection, before its lease ends, leads to `waited { mail }`. That holds on the Worker across hibernation and eviction too.
- **A put doesn't depend on waiters.** The same sequence of requests, with and without waits standing, gives every put the same reply and the same store.
- **A wait never moves the cursor or delivers mail.** After any sequence of waits and looks, what the client has taken in, its cursor and its store are what the looks alone would give.
- **The limits hold:**
  - one wait per connection;
  - at most 128 tags and 600 seconds per wait;
  - waits counted as reads;
  - `waitingPerRange`, `waitingPer48` and `maxWaitedTags` never exceeded;
  - a put never wakes the connection that made it, or a wait past its lease.

### Left for later

- **Notifications while Pigeon is closed** (#145, Web Push) share the trigger, a put under a tag that someone is waiting on, so the index is built so that a waiter could later be a stored push subscription too. Everything else is that decision's to make: a subscription has to be written down, the push service learns when mail comes, and a closed Pigeon can't name tomorrow's tags. A wait has none of these problems, because its Pigeon is there to renew it.
- **Padding tag lists with decoys**, `list` and `wait` together, to hide how many friends someone has. Filed as its own p3 issue.

## Consequences

Two connected Pigeons, your own devices or friends, get each other's mail in seconds through any Lighthouse they share. A Lighthouse or Pigeon from before this works as it did. A Lighthouse learns presence to the second, and holds a waiting connection's tags in memory beside its address, where before it saw them once a look.

The official Worker keeps up to 30,000 connections and an index of up to 200,000 tags in memory, and costs nothing more while nobody puts: keepalives don't wake it, and a wake happens only when a put already has. Each open Pigeon now holds a connection, so a Lighthouse's connection limit counts people online rather than people looking. On a phone, waits work only while Pigeon is on screen, since the browser closes a background tab's sockets.

Ruled out:

- **A stream of pushes after one `watch`.** It breaks the rule that each request takes exactly one reply, and would need a new signed form with replay rules of its own.
- **Long-polling `list` over HTTP.** A pending request keeps the Durable Object awake and billed for its whole length, and each poll is a new connection.
- **Looking every 30 to 60 seconds while Pigeon is on screen.** It leaks nearly the same presence, arrives slower, and keeps the Worker awake.
- **One "doorbell" tag every sender rings.** It's a shared bucket that hands the Lighthouse your friends without your listing them.
- **Waits by tag prefix.** A stranger could wait on every prefix and learn when everything is put.
- **A wait that carries the mail.** It's a second way for mail to come in beside the look.
- **Waits written to the Durable Object's SQLite.** That writes a connection's tag set down.
- **Waits at Lighthouses you didn't choose.**
