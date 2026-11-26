/** @jsxImportSource @pigeon/pigeonhtml */
// Chapter 1: what Pigeon is made of, in one picture.

import { Pre } from '../page/page.pigeon.tsx'
import { Aside, chapterAddress, Figure } from './frame.pigeon.tsx'

export const ONE_PICTURE = (
  <>
    <p class="lead">
      <i>
        Pigeon is a messenger with nobody in the middle. Your computer talks straight to your
        friends' computers. There is no sign-up, no account and no company keeping your messages.
      </i>
    </p>

    <h2>Who you are</h2>
    <p>
      The first time you open Pigeon, your computer makes a <b>key</b> for you: a pair of long
      numbers, one kept secret and one you can show. The secret half stays in this browser, locked
      so tightly that not even Pigeon's own page can read it out. Everything you send is signed with
      it, so your friends know it was you.
    </p>
    <p>Your key also gives you two things your friends will see:</p>
    <ul>
      <li>
        a <b>fingerprint</b>, 16 characters such as <tt>3F2A 9C1B 77D0 E415</tt>, which you compare
        when you add someone;
      </li>
      <li>
        a <b>pigeon</b> of your own, drawn from your key, which looks the same on every friend's
        screen.
      </li>
    </ul>
    <p>
      Your name is whatever you choose, up to 32 characters. Names aren't unique, which is why the
      fingerprint matters.
    </p>

    <h2>How two computers find each other</h2>
    <Figure
      number={1}
      caption={
        <>
          Public relays only introduce the two of you. After that, your messages go straight across,
          or through a relay that passes them along sealed.
        </>
      }
    >
      <Pre
        text={`
     YOUR COMPUTER                                 MIKA'S COMPUTER
   +---------------+                             +---------------+
   |  Pigeon       |                             |  Pigeon       |
   |  your key     |                             |  Mika's key   |
   |  your chats   |                             |  Mika's chats |
   +---------------+                             +---------------+
           |                                             |
           |  1. "I'm in our room"  +-----------+        |
           +----------------------->|  public   |<-------+  1. "So am I"
                                    |  relays   |
           +<-----------------------|           |------->+
           |  2. how to reach Mika  +-----------+        |  2. how to reach you
           |                                             |
   +---------------+                             +---------------+
   |  you          |<===========================>|  Mika         |
   +---------------+                             +---------------+
                  3. messages, signed, go straight across,
                     or through a TURN relay that can't read them
`}
      />
    </Figure>
    <p>
      Computers on the open network can't simply call each other by name, so Pigeon uses a few{' '}
      <b>public relays</b> as a meeting point. Your Pigeon leaves word in a room only you and your
      friend can find, theirs does the same, and the relays pass along how to reach each other. Then
      the two computers connect directly and the relays drop out of the picture.
    </p>
    <p>
      Some networks block direct connections. Then a <b>TURN relay</b> carries your sealed packets
      between you. It can't read them and it stores nothing. You can also choose to go through it
      always; see <a href={chapterAddress('private-rooms')}>Your Private Rooms</a>.
    </p>

    <h2>Where your chats live</h2>
    <p>
      Your chats are kept in this browser, and your friend keeps the same chat in theirs. When
      you're both online, the two copies catch up with each other. A message you write while your
      friend is away is sealed so only their devices can open it and left at their Lighthouses,
      which hold it until they're back: neither of you has to be online at the same time.
    </p>
    <Aside title="Good to know">
      Clearing this browser's data for Pigeon clears your key with it, and with it who you are. A{' '}
      <a href={chapterAddress('recovery-key')}>recovery key</a> is how you come back as yourself.
    </Aside>
  </>
)
