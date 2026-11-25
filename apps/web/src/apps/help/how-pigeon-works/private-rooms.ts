// Chapter 3: pair rooms and the relay setting (docs/protocol.md, Rooms and Pairing; 0022, 0026).

import { pre } from '../page/page.ts'
import { aside, figure, helpLink, steps } from './frame.ts'

export const PRIVATE_ROOMS = `
<p class="lead"><i>Every pair of friends has a room of their own on the relays. Only the two of you can find it, only the two of you can get in, and it moves every day.</i></p>

<h2>A room named by a secret</h2>
<p>When you add a friend, your two Pigeons agree on a <b>pair secret</b>: 32 random bytes that only you two hold. Your room's name is worked out from that secret and from the date, so:</p>
<ul>
<li>nobody else can work out where you meet, even if they know who you both are;</li>
<li>the room has a new name every day, by the clock the whole world shares (UTC);</li>
<li>the room is locked with a password made from the same secret, so nobody can get in or read how your computers reach each other.</li>
</ul>
<p>Chats, buzzes and "is writing..." all go through this room.</p>

<h2>Around midnight</h2>
<p>Two computers' clocks are never quite the same, and a new day starts at midnight UTC wherever you are. So for the last hour of each day your Pigeon also waits in tomorrow's room, and for the first hour of the day in yesterday's. Friends whose clocks are less than an hour apart still meet.</p>
${figure(
  3,
  "Today's room and tomorrow's overlap for two hours around midnight UTC. The exact rule is in " +
    helpLink('pigeon://help/protocol/flows/pair-rooms-by-day', 'The Pigeon Protocol, A.2') +
    '.',
  pre(`
   UTC      22:00     23:00     00:00     01:00     02:00
              |         |         |         |         |
   Nov 24's room ===========================|
   Nov 25's room        |===================================...
                        |         |         |
                        |         |         +-- yesterday's room left
                        |         +-- the date changes
                        +-- tomorrow's room joined too
`),
)}

<h2>Friends from before</h2>
<p>Friends you made on an older Pigeon met in a room that anyone who knew who you both were could work out. The first time you're both online, Pigeon moves you: one of you hands the other a new secret in the old room, and you both move to your private rooms and leave the old one for good. You don't have to do anything.</p>

<h2>Going through the relay</h2>
<p>Normally your computer connects straight to your friend's whenever it can. That's fastest, but it means your friend's computer learns your <b>IP address</b>, the number your network goes by. If you'd rather it didn't, turn on the relay:</p>
${steps([
  'In Pigeon Messenger, open the <b>File</b> menu.',
  'Choose <b>Always Go Through the Relay</b>. A tick shows it is on. (It is also under <b>Connection</b> in Settings.)',
  'From now on every room, your private rooms and invites alike, goes through the relay only.',
])}
<br>
${pre(`
   RELAY OFF:   you <=====================================> friend
                     direct; your friend sees your address

   RELAY ON:    you <=========> [ TURN relay ] <==========> friend
                     sealed packets; your friend never sees your
                     address, and the relay keeps nothing
`)}
<br>
${aside(
  'Good to know',
  "The relay is slower, and it has to be reachable. If it can't be reached, Pigeon <b>doesn't</b> quietly connect directly instead. It stays unconnected, and a balloon says the relay can't be reached and where to turn the setting off.",
)}
`
