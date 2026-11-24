// The Read Me shown on first boot. Plain text, 46 columns, in the voice of the world.

export const README_TEXT = `        __
    ___( o)>     PIGEON  v0.1
    \\ <_. )     a messenger with nobody
     \`---'       in the middle
==============================================

Pigeon connects your browser straight to
your friends' browsers. No sign-up. No
database. No one reading over your shoulder.

When a friend is offline, a mutual friend
carries a sealed letter until they're back.

WHAT WORKS TODAY
  Chat with friends browser to browser:
  messages, buzzes, "is writing..." and
  away/busy. Chats are kept in this browser
  and catch up when you're both online.
  Files, letters and pages come later.

HOW IT WORKS
  1. Double-click "Pigeon Messenger"
  2. Click "Add a Friend", send the link
  3. Say hi. Buzz them if they're slow.

UNDER THE HOOD
  connections ..... WebRTC data channels
  finding peers ... Trystero, Nostr relays
  shared state .... signed append-only logs
  storage ......... IndexedDB (local only)
  crypto .......... WebCrypto keypairs

KNOWN LIMITS
  Strict office and mobile networks can
  block direct connections. Pigeon will
  tell you so.

Made by tomszir
  pigeon.tomszir.com
  github.com/tomszir/pigeon
`
