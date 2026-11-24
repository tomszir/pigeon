# Brief

What Pigeon is, the world it pretends to belong to, and the rules every feature keeps.

## What it is

A static website that boots into a fake 2003 desktop on a CRT monitor, 1024×768 unless you change the resolution. On it:

- **Pigeon Messenger**: chat with friends browser to browser, buzz them, send files.
- **Letters**: when a friend is offline, a mutual friend (or the Lighthouse) carries a sealed letter until they're back.
- **Pigeon Explorer**: a browser for `pigeon://` pages, homepages hosted by their owners and mirrored by friends, never by a server.
- **Page builder**: make a GeoCities-style homepage in [PigeonHTML](pigeonhtml.md).
- **Always on**: the Lighthouse peer and Coo, a bot that runs in your own tab, so a lone visitor still has something to do.

Live at `pigeon.tomszir.com` once shipped. It is a portfolio pet project: small, finished, and fun beats complete.

## The premise

An alternate 2003 where peer-to-peer won. There is no cloud: computers talk to each other, pages live on the machines of the people who care about them, and a page is "down" when everyone who hosts it is asleep. Everything in the world plays along: the portal, webrings, the "page not hosted" error, the Lighthouse as a public utility, Help files written in-world.

## Rules

- **Authentic, not a copy.** XP-era look and feel, but no Microsoft-owned assets, names or logos. See [design.md](design.md).
- **Honest P2P.** The UI always says who is serving what: direct, mirrored, carried, or offline.
- **No server of ours in the middle.** Static hosting plus public signaling relays plus the optional Lighthouse peer, which runs the same protocol as everyone else.
- **Of its era.** Pages are 2000s HTML/CSS only; screens are pixel-exact at 1× and scaled by whole numbers.
