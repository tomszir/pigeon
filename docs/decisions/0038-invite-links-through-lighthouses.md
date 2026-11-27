# 0038: Invite links through Lighthouses

An invite link leaves a sealed card at the inviter's Lighthouses, so friends can use it while the inviter is offline; each link has its own time limit and number of uses, and everyone who asks through it waits for the inviter's approval.

- Status: accepted; superseded in part by [0053](0053-claimed-invite-cards.md): cards are put claimed, and whoever opens a link reads the claimed ones first, so someone else holding it can no longer bury the card; and by [0060](0060-invite-links-bound-to-their-maker-for-a-week.md): a link is `#b/`, naming the device that made it and its end, lasts at most 7 days, and only that device's cards and answers count, so your other devices no longer close a removed device's invites, and `#a/` links no longer open
- Date: 2026-11-25

## Context

An invite today ([0018](0018-invite-codes-and-short-links.md)) is one code, hosted for 30 minutes while the inviter's tab is open, and it pairs once. Sending one link to a few friends, or to someone who'll open it tomorrow, doesn't work: both people have to be online together, within half an hour, one at a time. The roadmap's M7 asks for links that pair through the M16 mailbox ([0037](0037-the-lighthouse-and-its-mailbox.md)). The maintainer also wants one link several friends can use, with a time limit, and nobody having to be online at the same time as anyone else.

A link that works while you're offline can't rely on you answering to prove who you are. Whoever holds a link with several uses shares it with everyone else it went to, and a link can be forwarded further than you meant. A Lighthouse keeps mail for 30 days at most, lets anyone who knows a tag put and read under it, and limits puts per address range and per tag.

## Decision

### The link

- **Each invite has a 16-byte random secret.** Its link is `https://pigeon.tomszir.com/#a/<secret><fingerprint>`, both in base32: the secret, then the first 16 bytes of the SHA-256 of the inviter's identity. That's 52 characters after `#a/`, one line in a chat and one QR code. The fingerprint is longer than an `#i/` link's because a link may be in other people's hands for 30 days, time enough to try matching a shorter one.
- **Where it's left.** The card goes to every Lighthouse on the inviter's list that has no pass. A Pigeon opening a link looks at the official Lighthouses and at the one the link names, if any. A link names one, as `?l=<pigeon://lighthouse address>`, only when the inviter's list has none of the official ones. A list with only pass-protected Lighthouses can't make links: a pass in a link would be a pass for everyone who has it.
- **Limits** are chosen from presets when the link is made: 1 hour, 1 day, 7 days (the default) or 30 days, and 1 (the default), 5, 10 or 25 uses. Nothing lasts past 30 days, since no Lighthouse keeps mail longer; a 30-day card asks for an hour less, as all puts do.
- **Several invites at once.** Add a Friend lists your open invites, with the time and uses left, and who's waiting on each, and lets you cancel any.
- **Typed codes stay as they are**: live, single-use, 30 minutes. A code is too short to carry a secret that keeps a card hidden for days.
- **Older Pigeons** don't know `#a/` and say the link isn't an invite. `#i/` links and typed codes still work both ways.

### The card

- **The card says who made the invite.** It is `{ v: "pigeon/invite-card/v1", identity, deviceLog, keys, name, lighthouses, expires, open, from, tag, sig }`, signed by the device that made the invite, which must be active on the log it carries. `open` is false once the invite is closed, and `tag` is its own card tag, so a card can't be moved to another of your links. It's sealed with AES-256-GCM under HKDF of the secret (info `pigeon/invite/key`) and put under the tag `HMAC-SHA256(secret, "pigeon/invite/v1/card")` until the invite expires. Its only drop key is the device's own, which never leaves it, so nobody else can take the card down.
- **A card follows your device log.** Whenever your log, name or Lighthouses change, every open invite's card is signed again and put again, and the old one is dropped.
- **The person opening the link checks every card under the tag.** The identity's fingerprint must match the link's, the device log must verify, its signer must be active on it, and each sealing key must be signed by its own device. Of the cards that hold, the one with the newest log (epoch, then length) wins, and a closed one ends the invite. Only then are the inviter's name and fingerprint shown, with Ask to Be Friends. Anyone else with the link can put a card of their own, but it can't match the fingerprint, and a card a removed device made from your old log loses to the one your devices put with the newer log.
- **What a card shows** to everyone holding the link, for as long as it lasts: your name, your device log (with your devices' names and when each was added) and your Lighthouses without passes.

### Asking and answering

- **Asking leaves a request.** It's a `mail:invite` letter to the inviter, sealed to the inviter's devices on the card, so another holder of the link can see that requests have come but not who sent them. Its body holds the invitee's name, device log, devices' sealing keys and Lighthouses (at most two, without passes; a Pigeon with none can't ask), a random 16-byte reply secret, and the link's card tag, so it counts only for the link it was sent through. It goes under `HMAC-SHA256(secret, "pigeon/invite/v1/ask/" + UTC date)` at the Lighthouses the card names. A request is at most 16 KB; the inviter skips bigger blobs by the size `list` reports, gets at most 200 per link at each check (the rest at the next), and keeps at most 50 waiting on a link; one more is answered "busy", to ask again later.
- **Every request waits for you**, whatever the number of uses: a link in a screenshot or forwarded on brings in nobody you haven't approved. Requests show in Add a Friend with the name, the fingerprint, a note when the name is the same as a friend's or another request's, and a reminder to check the fingerprint with them some other way. Approve uses up one use; Decline uses none.
- **Who can't ask.** A request from someone you've blocked is dropped without a word and uses nothing. One from someone already your friend shows as such, and approving it pairs you again, as pairing again does now. A Pigeon refuses to ask through its own link.
- **The answer** is a `mail:invite-answer` letter sealed to the invitee's devices, under `HMAC-SHA256(reply secret, "pigeon/invite/v1/answer/" + UTC date)` at the invitee's Lighthouses, so nobody else holding the link can tell who was answered. Approving puts in a new 32-byte pair secret, your name and your device log; both of you are then friends who meet in the secret's rooms. Declining says so. A request that comes after the invite closed or expired is answered "closed", at most 20 times a link, and everyone still waiting when a link closes is told the same. Approving after the invite expired is refused. Each of the invitee's devices that asks gets the answer under its own reply secret.
- **Invites belong to the device that made them.** Only it approves, declines, counts uses and answers, so two devices never answer one request differently or go past the limit. Your other devices see each open invite (its limits and uses left, shared in the self mailbox, never the drop key) but leave the requests to that device. When that device is removed, or a recovery leaves it off, each of your devices that hears of it puts a closed card for its invites, signed on the newer log, which wins over any card the removed device puts.
- **Delivery.** A request isn't put again: the answer is its receipt. An added answer is put again every 3 days until the device that asked sends its receipt, under the new pair secret, for 30 days at most. Approving is kept before the answer is sent, so a Pigeon closed in between finishes it when it next opens. While an invite is open, its device looks for requests every 30 seconds while Pigeon runs, and so does the invitee's device for the answer while a request waits, until the invite expires. Each letter counts only from a device active on the log it carries, like any mail.

## Consequences

You can send one link to several friends, or to someone who'll open it next week, and nobody has to be online at the same time. Nobody gets in without your approval, so a leaked link costs you some requests to decline, not strangers in your list. Approving is only as safe as the fingerprint check: someone a link was forwarded to can call themselves by a friend's name.

Everyone holding the link sees what the card shows, and can see how many requests came, but not from whom or who was answered. Watching the card and request tags, a Lighthouse can tie together the addresses of the inviter and of everyone using the link, as 0037 says of any tag. Someone with the link can fill its tags with junk up to the Lighthouse's limits; the size cap and the daily request cap bound what the inviter fetches, and the cost is real requests being late or crowded out until the invite is cancelled.

A removed device still knows the secrets of your invites. Until a closed card signed on the newer list reaches the Lighthouses, it can answer requests sent to it, as you, through the invites it made. Someone it answers becomes friends with a device your list doesn't have, finds out the first time they meet your real devices, and is left with nobody to talk to. Making an invite again from a device you trust is the fix.

A link is 52 characters after the `#`, longer than today's 23. Links don't pair live any more: two people online together wait up to a minute, and a link needs a Lighthouse to be reachable. Only the device that made the request takes the answer; the invitee's other devices hear of the new friend when the friends list is synced between devices.

Ruled out:
- **Adding up to the limit without asking**: a forwarded link would let strangers in.
- **Sealing requests to the secret alone**: everyone holding the link could read who else asked.
- **Answer tags from the invitee's identity**: anyone with the link could check whether a guessed person asked.
- **Typed codes through Lighthouses**: 40 bits can't keep a card hidden for days.
- **Keeping a live path for links beside the mailbox**: two ways to pair through one link, for a minute saved.
- **A "Live invites only" setting**, which M7 listed: codes are the live way, so the setting would switch nothing.
