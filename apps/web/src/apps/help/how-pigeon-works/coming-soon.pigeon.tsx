/** @jsxImportSource @pigeon/pigeonhtml */
// Chapter 7: what's planned and not built yet: mutual friends carrying letters, pages, files, groups.

import { Pre } from '../page/page.pigeon.tsx'
import { Figure, NOT_BUILT, Steps } from './frame.pigeon.tsx'

export const COMING_SOON = (
  <>
    <p class="lead">
      <i>
        Pigeon is still being built. Everything on this page is planned and not built yet. You'll
        see some of it greyed out in the menus already.
      </i>
    </p>

    <h2>Letters carried by friends {NOT_BUILT}</h2>
    <p>
      A message you write while a friend is away already goes as a <b>letter</b>: sealed so only
      their devices can open it, and left at their <b>Lighthouses</b> until they're back. Later, a{' '}
      <b>carrier</b>, a friend you both have who happens to be online, will be able to carry it too,
      so it gets through even when no Lighthouse can be reached.
    </p>
    <Steps
      items={[
        <>You write to Mika while she is offline. Pigeon seals it to Mika.</>,
        <>
          Alex, a friend of you both, is online: your Pigeon hands the letter to Alex as well as to
          the Lighthouses.
        </>,
        <>Alex keeps it, unable to read it, for up to 30 days.</>,
        <>
          When Mika and Alex are next online together, Alex delivers it, and drops it once Mika
          signs that she has it.
        </>,
      ]}
    />
    <br />
    <Figure
      number={7}
      caption={
        <>A letter carried by a mutual friend while Mika is away. (Planned, not built yet.)</>
      }
    >
      <Pre
        text={`
     YOU                       ALEX (carrier)                    MIKA
      |                             |                         (offline)
      |--- sealed letter ---------->|                             .
      |    for Mika                 |  keeps it, can't read it    .
      |                             |  ...hours later...          |
      |                             |--- the letter ------------->|
      |                             |<-- "got it", signed --------|
      |                             |  drops its copy             |
`}
      />
    </Figure>

    <h2>Pages on Pigeon Explorer {NOT_BUILT}</h2>
    <p>
      Pigeon Explorer is a browser for <tt>pigeon://</tt> addresses. These Help pages already come
      with Pigeon and open from this computer. Later, anyone will be able to make a homepage of
      their own, kept on their own computer and copied by friends who mirror it, so it stays up
      while its owner sleeps. A page nobody is hosting shows "page not hosted".
    </p>
    <p>
      Pages are written in <b>PigeonHTML</b>: the HTML of the time, with tables, fonts and colours,
      and no scripts. They are kept small enough to load over a dial-up line, 100 KB each.
    </p>

    <h2>And more</h2>
    <ul>
      <li>
        <b>Files</b> {NOT_BUILT}: sending pictures and files to a friend.
      </li>
      <li>
        <b>Groups</b> {NOT_BUILT}: rooms for a few friends at once.
      </li>
    </ul>
  </>
)
