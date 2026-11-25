// Chapter 7: what's planned and not built (docs/protocol.md, Letters and pigeon:// addresses).

import { pre } from '../page/page.ts'
import { figure, NOT_BUILT, steps } from './frame.ts'

export const COMING_SOON = `
<p class="lead"><i>Pigeon is still being built. Everything on this page is planned and not built yet. You'll see some of it greyed out in the menus already.</i></p>

<h2>Letters ${NOT_BUILT}</h2>
<p>Today a message reaches your friend only when you are both online. Letters will change that: a letter is sealed so only your friend can open it, and a <b>carrier</b>, a friend you both have who happens to be online, or the <b>Lighthouse</b>, an always-on Pigeon, holds it until your friend comes back.</p>
${steps([
  'You write to Mika while she is offline and choose <b>Seal a letter</b>.',
  'Your Pigeon seals it to Mika and hands it to a carrier who is online.',
  'The carrier keeps it, unable to read it, for up to 30 days.',
  'When Mika comes online, the carrier delivers it, and drops it once Mika signs that she has it.',
])}
<br>
${figure(
  7,
  'A letter carried by a mutual friend while Mika is away. (Planned, not built yet.)',
  pre(`
     YOU                       ALEX (carrier)                    MIKA
      |                             |                         (offline)
      |--- sealed letter ---------->|                             .
      |    for Mika                 |  keeps it, can't read it    .
      |                             |  ...hours later...          |
      |                             |--- the letter ------------->|
      |                             |<-- "got it", signed --------|
      |                             |  drops its copy             |
`),
)}

<h2>Pages on Pigeon Explorer ${NOT_BUILT}</h2>
<p>Pigeon Explorer is a browser for <tt>pigeon://</tt> addresses. These Help pages already come with Pigeon and open from this computer. Later, anyone will be able to make a homepage of their own, kept on their own computer and copied by friends who mirror it, so it stays up while its owner sleeps. A page nobody is hosting shows "page not hosted".</p>
<p>Pages are written in <b>PigeonHTML</b>: the HTML of the time, with tables, fonts and colours, and no scripts. They are kept small enough to load over a dial-up line, 100 KB each.</p>

<h2>And more</h2>
<ul>
<li><b>Files</b> ${NOT_BUILT}: sending pictures and files to a friend.</li>
<li><b>Invites that wait</b> ${NOT_BUILT}: a link your friend can open while you're offline.</li>
<li><b>Groups</b> ${NOT_BUILT}: rooms for a few friends at once.</li>
</ul>
`
