# 0039: Link previews without the inviter

Every link to Pigeon, invite links included, previews the same way: the page's own title, description and one share card, never who sent the invite.

- Status: accepted
- Date: 2026-11-25

## Context

Chat apps, social sites and search engines fetch a link and read its `og:` and `twitter:` tags to draw a preview. A preview that said "Toms invited you to Pigeon", maybe on a picture drawn for that link, was wanted for invite links.

An invite link's secret and fingerprint sit after its `#` ([0038](0038-invite-links-through-lighthouses.md)), and a browser never sends that part to a server. That is what keeps an invite out of Cloudflare's logs and out of every crawler that fetches the link. Whatever the Worker sees, every invite link looks like `https://pigeon.tomszir.com/`.

## Decision

- **One preview for everything.** `apps/web/index.html` carries a description, a canonical address, Open Graph and Twitter card tags, and a schema.org `WebApplication`, all saying what Pigeon is: a 2003 desktop with Pigeon Messenger and Pigeon Explorer. The description tells someone holding an invite link to open it to add the friend who sent it.
- **One static share card**, `apps/web/public/share-card.png` (1200×630), rendered from `assets/brand/share-card.html` with the house fonts, orb and wallpaper at 2× and through the same CRT effect as the desktop.
- **Nothing about the inviter goes before the `#`.** The link format stays as 0038 has it.
- **The inviter's name goes in the message instead.** Copy Link copies "Toms invites you to Pigeon!" with the link on the next line, so the chat shows who it's from beside the preview. Pasted into Have an Invite?, the whole message opens, since a link is read from its last `#`.

## Consequences

- The preview itself can't say who sent an invite; the copied message says it, and the person sees it checked when the link opens and its card is checked.
- Nothing new reaches a server or a crawler, and the preview can't be made to lie about who sent a link.
- Ruled out: a `?from=<name>` before the `#`, with the Worker writing the name into the tags, opt-in or not. It would put the name in server logs and crawlers' hands, anyone could write any name, and it changes the link format. A picture drawn per link was also ruled out: on top of the same problem, it would need a renderer such as satori and resvg in the Worker.
- Changing the card means editing its master and running `mise run share-card`.
