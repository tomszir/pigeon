# 0064: A threat model for friends and small groups

Pigeon's threat model is scoped to a messenger for friends and small groups: messages, keys and who can speak as whom are defended in full, and four classes of residual risk are accepted, stated in the threat model and given no mechanism.

- Status: accepted
- Date: 2026-11-28

## Context

Reviews of the Lighthouse wait model and of device sync kept turning up findings that were real but cost more to close than they protect. Each needed a limit, a rule or a new field to stop an attacker with many networks, or a device of the victim's own, from doing something that reveals no message and forges no one. Closing one tended to open the next, and each round of review made the protocols heavier for the people they are for.

Pigeon is for a person and the friends they chose, in rooms of a few people. That says who the attackers are: strangers on the internet, the infrastructure Pigeon runs over, and a friend or a lost device. It doesn't include someone with hundreds of addresses spending effort to annoy a group of friends.

## Decision

Two tiers.

**Defended in full.** Designed against, modelled and reviewed:

- Confidentiality of messages and of every key and secret, including against removed devices once their removal is known.
- Forgery and impersonation: no one can speak as you or as a friend.
- Anything that breaks normal use with no attacker involved: lost or stalled mail, sync that stops, crashes.

**Accepted, and out of scope for design and review.** The residual is stated in [threat-model.md](../threat-model.md#accepted-residuals), and no mechanism is added for it:

1. Resource exhaustion by an attacker with many networks, such as tens of IPv6 /48s or hundreds of IPv4 addresses, filling Lighthouse budgets or making Lighthouses or clients do more work. Per-address limits stay; global exhaustion is accepted.
2. Metadata that others on your network, or holders of a tag, can infer from limits and wakes: how many tags you wait on, when you are open, false wakes aimed with a tag prefix.
3. Consistency games by one of your own devices while it is still on your list, or in the window before your other devices hear it was removed: stamping entries far ahead or at the cap, forking or gapping its entry numbers, backdating. These can make your devices disagree, or keep its entries counting longer. They can't reveal your messages or forge someone else. Removing the device and pairing again repairs it.
4. A hostile Lighthouse making a client fetch a lot. Use Lighthouses you trust.

The line between the tiers is what an attack reaches. If it reads a message, a key or a secret, or lets someone speak as you or a friend, it is in the first tier whatever it costs the attacker. If it only costs resources, reveals how much or when, or makes a device you hold disagree with itself, and is repaired by removing a device, it is in the second.

## Consequences

- Review briefs mark these four classes out of scope, so reviewers spend their rounds on the first tier.
- Issues that only cover these classes are closed as accepted, with a pointer to this record. An issue that covers one of them and something in the first tier stays open for the part that is.
- A "written after" pointer on shared-log register entries, planned to order an entry after the ones its device had seen, is not built: it is a defence against class 3.
- The cap on how much one mail fetch takes from a Lighthouse (#170) is parked with no release: it is class 4.
- Per-address limits at Lighthouses stay as they are, and the numbers in the threat model say what they do and don't cover.
- A person who needs more than this, such as a group exposed to a determined attacker with many networks, isn't served by Pigeon's design. The threat model says so instead of leaving it to be found.
- Reversing a class takes a new record that supersedes this one.
