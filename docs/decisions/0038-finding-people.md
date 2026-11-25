# 0038: Finding people

Beyond the invites you hand out, people find you in two ways you choose: a friend introduces you to another of their friends, and nothing comes of it unless both of you say yes, or you list yourself in a Lighthouse's directory for anyone to find.

- Status: proposed
- Date: 2026-11-25

## Context

Today the only way to become someone's friend is an invite they give you in person or by link. That keeps Pigeon free of spam and strangers, but a messenger where you can't find anyone is a lonely one, and the premise has a phone book of its era in mind: the portal, webrings, a lobby. The roadmap puts public places after M6, "with moderation designed first". Finding people needs the same care but less of it: one person reaching out to another, who can refuse.

Both are built on the Lighthouse's mailbox ([0037](0037-the-lighthouse-and-its-mailbox.md)); the directory also uses M7's standing invites, which wait for an answer while the inviter is offline. A review of the first draft found that an introducer could have watched how their introduction went, that a listing signed by "your identity's key" breaks once you have several devices or have recovered, and that a standing invite in a public listing is an open door for harassment. This version answers each.

## Decision

### Introductions

- **A friend asks the second person first.** Choosing Introduce... on a friend (A) picks another friend (B) and a line about why. B gets a sealed request in their mailbox: "Rook would like to introduce you to Mika", with A's name and bird, and nothing else. Only if B says yes does A get anything: B's name, bird and fingerprint, the line, and that Rook made the introduction. A then decides too.
- **The introducer isn't told.** Rook hands each side the other's identity, device log and sealing keys, as Rook keeps them. Once both have said yes, they pair through the mailbox under tags from ECDH between each of A's devices and each of B's as named in the introduction, so whichever device answers can work them out and Rook can't, and agree a pair secret of their own in their first mail. Rook isn't told what happened next. A Rook who lies about either side could sit in the middle of the pairing, since neither side has met the other: that's true of any introduction, and comparing fingerprints some other way (a call, in person) is how to be sure.
- **The requester is checked.** A pairing that arrives through an introduction must come from the key the introduction named; any other is refused. An introduction is sealed to the two people in it and can't be passed on.
- **What each side learns.** B, by being asked, learns that Rook wants to introduce them to A, before A has said anything; that's what being asked first costs. A learns about B only once B has agreed. Whoever accepts and hears nothing back for 7 days is told the introduction lapsed. They can tell the other didn't accept, but not whether they declined, missed it, or were never online.

### The directory

- **Opt-in, on a Lighthouse.** In Settings, List Me in the Directory... puts a listing on one of your Lighthouses: your name, your bird, an optional line, and a standing M7 invite made for the directory. Nothing else: no friends, no status, no devices.
- **A listing is signed by one of your devices**, one per identity per Lighthouse. It's signed by a device that's active on your device log, with the log attached, so any of your devices can renew it and a recovered Pigeon can too (0024, 0027). It lasts 30 days and is renewed while you keep it on; taking it off removes it. The Lighthouse keeps the newest log it has seen for each identity ever listed there, after the listing is gone too, and refuses a listing signed by a device that log has removed. A device removed before the Lighthouse saw a log showing it could still list you; listing or unlisting once from a remaining device closes that. The bird and fingerprint beside each name mean nobody can list as your key, though anyone can choose any name.
- **Finding someone.** Find People... searches a Lighthouse's directory by name: at least three letters, a few dozen results at most, and a limited number of searches per address an hour, so the directory can't be dumped wholesale. Adding someone sends a pairing request through their standing invite; listing yourself never adds anyone on its own.
- **Standing invites resist harassment.** A request through a standing invite carries a proof of work, much harder than a mailbox `put`, so sending many costs a lot. You set how many requests a day you'll see (five unless changed); more wait unread until you look, and blocking someone stops theirs. Requests are short and sealed to your devices.
- **What the Lighthouse knows.** A directory is public: its Lighthouse and everyone using it see each listing. A Lighthouse watching live can see that an address searched for someone and then put a request in their bucket, as 0037's privacy page says of all mail.
- **A written policy first.** As the roadmap asks of any public feature, the directory ships with its rules written down (what may be listed, what gets taken down, how to report), shown in Find People and kept by each Lighthouse that runs one.
- **Moderation is the operator's.** A Lighthouse's operator keeps a refusal list (keys, names and words) and can take a listing down. Each key has one listing per Lighthouse, and an address may make a few listings a day. A listing can be reported from Find People; reports go to the Lighthouse for its operator. The stacked, followable labels the roadmap plans for public places aren't needed for one operator's directory and wait for their own decision.
- **Directories don't mesh.** Listings stay on the Lighthouse they were made on, so each operator moderates only their own. The official Lighthouses share one directory, since one operator runs them.

### When

- Both come in a new milestone, M18, after M7: the directory needs M7's standing invites, and introductions pair through the same mailbox handshake M7 builds.

## Consequences

People can find each other without meeting first, and every way needs the person found to agree. Introductions keep to your friends' friends, ask the person asked before telling anyone about them, and leave the introducer out of what follows. The directory is the one public thing in Pigeon, and it brings what public things bring: spam, names that imitate other people, people found who'd rather not be. Signatures and birds stop anyone taking your key, though not your name; work and a daily cap make harassing someone through their listing slow and quiet; and opting in is the only way in. Running a directory makes its operator a moderator, with the duties that brings in some places (in the EU, acting on notices of illegal content), which is why directories don't mesh and the official one is the author's to keep.

Ruled out: friends of friends listed automatically (it would publish your friends list), search by anything but a name you chose (phone numbers and emails don't exist in Pigeon, and would leak), a directory without signatures, and introductions where the introducer makes the invite (they could watch it used).
