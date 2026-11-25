// The Read Me shown on first boot. Plain text, 46 columns, in the voice of the world.

export const README_TEXT = `        __
    ___( o)>     PIGEON  v${__PIGEON_VERSION__.split('.').slice(0, 2).join('.')}
    \\ <_. )     a messenger with nobody
     \`---'       in the middle
==============================================

Pigeon connects your browser straight to
your friends' browsers. No sign-up. No
database. No one reading over your shoulder.

WHAT WORKS TODAY
  Chat with friends browser to browser:
  messages, buzzes, "is writing..." and
  away/busy. Chats are kept in this browser
  and catch up when you're both online.
  Every friend has a pigeon of their own,
  drawn from their key, the same everywhere.
  Use Pigeon on your phone and laptop at
  once, as the same you.
  Letters, files and pages come later.

HOW IT WORKS
  1. Double-click "Pigeon Messenger"
  2. Click "Add a Friend", send the link
  3. Say hi. Buzz them if they're slow.
  On another device: File, Link a Device
  on this one, then type the code there.

UNDER THE HOOD
  connections ..... WebRTC data channels
  finding peers ... Trystero, Nostr relays
  your rooms ...... named by a secret only
                    you two hold, renamed
                    every day
  shared state .... signed append-only logs
  storage ......... IndexedDB (local only)
  crypto .......... WebCrypto keypairs

LIGHTHOUSES
  When a friend is away, a Lighthouse
  holds what you leave for them, sealed so
  only their devices can open it. Your own
  devices leave each other what changed
  there too: your name, your devices and
  your Lighthouses. It keeps
  no names and nothing it can read, for 30
  days at most. It does see your address
  when you connect. Network, on the
  desktop, shows yours: Loft, Dovecote and
  Perch unless you add your own.

KNOWN LIMITS
  Some networks block direct connections;
  Pigeon then goes through a relay that
  can't read your messages. Always Go
  Through the Relay, in Network, hides your
  address from friends too.
  Only your first device links and removes
  devices. Keep it safe.
  On an iPhone, add Pigeon to the Home
  Screen, or Safari forgets it in 7 days.

Made by tomszir
  pigeon.tomszir.com
  github.com/tomszir/pigeon
`
