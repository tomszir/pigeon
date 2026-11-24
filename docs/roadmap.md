# Roadmap

The milestones in order, and the check that says each one is done.

| Milestone             | Scope                                                                                                                              | Done when                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M1 · Desktop shell    | Stage and scaling, window manager, taskbar, menu, tray and balloons, the UI kit from the canvas's Components board, Read Me window | the canvas's Desktop board works offline with no P2P at all    |
| M2 · Two tabs talking | Identity, pairing by link and QR, pair rooms, Messenger with buzz and typing; adds Trystero and Playwright                         | two browsers on different networks chat                        |
| M3 · Files            | Chunked transfer with progress, accept and decline, resume                                                                         | a 50 MB file arrives intact                                    |
| M4 · Letters          | Sealing, carriers, delivery, receipts, Letters in Flight                                                                           | A → C → B works with A and B never online together             |
| M5 · Pigeon Explorer  | Resolver, page host and mirrors, page builder, PigeonHTML, widgets, the "not hosted" page                                          | Mika's page loads from a mirror while Mika is offline          |
| M6 · Always on        | Lighthouse peer, lobby, starter pages, Coo bot                                                                                     | a first-time visitor alone at 3 a.m. still has something to do |

Current state: M1 is built. The desktop boots offline with Read Me open; the Messenger shows the real, empty state, and `?demo` (or "See a sample conversation") plays the Desktop board's sample, labelled as such. Letters, Shared Files and Pigeon Explorer open an in-world "still being built" message. Window positions and settings live in memory only until M2 adds storage.
