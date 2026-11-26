# 0053: Claimed invite cards

An invite link's cards are put claimed, so only the inviter's devices can add to the claimed blobs under its card tag, and whoever opens the link reads those first.

- Status: accepted
- Date: 2026-11-26

## Context

[0038](0038-invite-links-through-lighthouses.md) leaves a link's card under a tag made from the link's secret, and the person opening the link checks every card there: anyone else holding the link can put a card, but it can't match the link's fingerprint. Checking is cheap; finding the card is not. Opening a link listed 500 items under the tag and fetched the newest 100. A Lighthouse lets one address range put 200 blobs under a tag a day, and counts an IPv6 /64 as a range, so one IPv6 /48 can put 8000 an hour. Anyone holding a link could put enough under its card tag to push the card out of what an opener reads, and the link stopped working for everyone until it was made again.

Anything an opener can work out from a link, everyone else holding it can work out too, so nothing the opener does alone can tell the card from the rest before fetching it. Fetching more only raises how many blobs it takes. Putting the card's id in the link doesn't hold, since the card is put again whenever the inviter's device log, name or Lighthouses change, and when the link closes, and links already given out can't change. A key for each link in the link, with signed puts the Lighthouse checks, would work for new links, but makes every link longer, can't be opened by older Pigeons, and does nothing for links already shared. Only the Lighthouse can tell who may add to a tag.

A Lighthouse that locked a tag to whoever claimed it first would let anyone who knows a tag shut everyone else out of it: claiming a link's request tag for the day would stop every request. And a device of yours puts a closed card for a link another device made once that device is removed, so whatever lets the maker put cards has to reach your other devices.

## Decision

- **Claimed puts.** A `put` may carry a `claim`, 32 bytes. The Lighthouse keeps its SHA-256 with the blob, as the blob's owner, and never tells it. A claimed put is refused as `taken` while a claimed blob under the same tag, not yet expired, has another owner. Ordinary puts under the tag are untouched, and `list` lists everything as before. A new request, `list-claimed`, lists only the claimed blobs. A claimed blob's id covers its owner too, so the same bytes put unclaimed by someone else never stand in for it. The claim is a hash commitment like a drop, so the Lighthouse needs no signature checks and no record beyond the blob.
- **A claim key for each link.** A link gets 32 random bytes when it's made. At each Lighthouse its cards are claimed with `HMAC-SHA256(claim key, "pigeon/invite/v1/claim/" + Lighthouse id)`, so a Lighthouse that sees the value it was given can't use it at another. The first card is put before the link is shown to anyone, and the link is shown only once a Lighthouse that every opener reads (your official ones, or the one the link names) holds it: at one of those, the inviter's devices hold the claim from the start. A Lighthouse the first put missed gets the card at the next start or mail check, and someone holding the link could claim its tag there first; the card is then kept unclaimed there, and the one at a Lighthouse every opener reads still holds.
- **Your other devices get it.** The device that made the link includes the claim key in the links it shares in the self mailbox, never the drop value. A device that puts a closed card for another's link, after that device is removed, claims it with the same key, so the closed card lands among the claimed ones and still wins on the newer log.
- **Opening a link** reads, at each Lighthouse, the claimed cards first (up to 16, newest first), then everything under the tag as before (up to 100 of the newest 500), skipping cards already fetched, and chooses among the cards that hold exactly as before. The second read stays for a Lighthouse from before claims, which refuses `list-claimed` as malformed and keeps everything unclaimed, for a card not claimed yet, and for a closed card from one of your devices that doesn't claim them.
- **Answering for a removed device's links.** Your devices still on the list fetch the ask tags of links whose maker was taken off, until two days after each ends, and answer a request through one `closed`, at most 20 times a link. Every `closed` answer now carries the answering device's copy of your device log. An asker merges it: before being added, no `added` for that request is taken after it; after being added (the asker keeps looking at that request's answers until two days after the link ends), the removed device stops counting as you for them. It works when the removed device's card lists your other devices and Lighthouses, as a card Pigeon puts does; one that lists only the removed device is seen by nobody else.
- **Links made before this.** The device that made one gives it a claim key at its next start or mail check, and puts its card again with it. If someone holding the link has claimed its tag at a Lighthouse first, the put there is refused as `taken` and is made again unclaimed, as it was.
- **A card that didn't get somewhere is put there again.** Where a put doesn't get through, the card already at that Lighthouse stays and is still known (before, it was taken down, leaving nothing there), and the card is put there again at every start and mail check until it gets through. A claim is only made where a put lands, so this is also what claims an old link's tag once its Lighthouse is back.

## Consequences

Someone holding a link made now can still put as much under its card tag as a Lighthouse lets them, but can't hide the card: it's among the claimed ones, which they can't add to, and the junk only costs an opener the capped read it cost before. No link format changes, older Pigeons open new links as they did, and a Lighthouse that doesn't know claims stores cards unclaimed and works as before.

What isn't covered:
- A link made before this, whose tag someone claimed before its device's claimed put landed there, can be buried as before at that Lighthouse. Making the link again is the fix.
- A card that is only at Lighthouses from before claims (a link naming its own Lighthouse with `?l=`) can be buried until that Lighthouse is updated.
- A removed device knows the claim key of every link it heard of, so it can still put claimed blobs under those tags, enough to push the closed card your other devices put out of the 16 claimed cards an opener reads, and then an open card of its own on the list from before. Someone opening the link may ask through that card, and the removed device may add them first, as you. What limits it is the next point, and that links end within 30 days. Making the link again from a device you trust gives one it never heard of.
- Until every one of your devices claims cards, a closed card from one that doesn't is unclaimed, and only the second read finds it.

The claim key is a secret held in JavaScript on each of your devices. It lives no longer than the link, at most 30 days, and gates nothing but who may add to one tag.

The Lighthouse protocol gains a request and an error without changing its number: a Lighthouse that predates claims ignores the `claim` field and refuses `list-claimed` as malformed, which is how a client tells. A claimed blob's id is no longer the same at every Lighthouse, as each is given a different claim.

Ruled out:
- **The card's id or hash in the link**: the card is put again too often, and links already given out can't change.
- **A key for each link in the link, with puts the Lighthouse checks the signature of**: a longer, new link format that older Pigeons can't open, and nothing for links already shared.
- **Claims that lock a whole tag**: anyone who learns a tag, such as a link's request tag, could shut out everyone else.
- **Lighthouses that check the device log on claimed puts**, so a removed device's claimed cards stop counting there: it would close what a removed device can still do through a link, but every Lighthouse holding a card would learn who made the link, their device log and their other links. Lighthouses stay blind to who made a link.
- **A claim key replaced after a removal**: the removed device holds the old one, so either side could replace it, and the first to do so wins.
- **Reading more, or oldest first**: one IPv6 /48 can put more than any opener can fetch, and the oldest card is gone once the card is put again, while a removed device's open card would win over the newer closed one.
