// Chapter 4: linking and removing devices (docs/protocol.md, Devices).

import { pre } from '../page/page.ts'
import { aside, chapterAddress, figure, helpLink, steps } from './frame.ts'

export const YOUR_DEVICES = `
<p class="lead"><i>You can use Pigeon on your computer and your phone as the same person. Each device keeps a key of its own, and a signed list ties them together.</i></p>

<h2>Your list of devices</h2>
<p>Every device you use makes its own key, the same way your first one did. Your <b>list of devices</b> says which keys speak for you. It is signed, entry by entry, and only one device may write it: the device that <b>manages your list</b>. That is your first device, unless you have used your ${helpLink(chapterAddress('recovery-key'), 'recovery key')} to hand the job to another.</p>
<p>Your friends keep a copy of your list. They take messages from any device on it and see one of you, with one status. They can tell how many devices you have, and which one is connected.</p>

<h2>Linking a new device</h2>
<p>Linking is done in person, with both devices in front of you. The new device must be a Pigeon with no friends of its own yet, since it takes on yours. If it already has some, because you started Pigeon on both, <b>Link to My Other Device</b> on it offers to <b>leave</b> that Pigeon first: if it's on no other device, its friends who are online are told you left, everything on it is forgotten, and the link goes ahead. Check the code first: it's only tried once the old Pigeon is gone. Add those friends again from the Pigeon you keep.</p>
${steps([
  '<b>On the device that manages your list</b>, open Pigeon Messenger and choose <b>File</b>, <b>Link a Device</b>. It shows a code, a link and a QR code, good for 10 minutes.',
  '<b>On the new device</b>, choose <b>File</b>, <b>Link to My Other Device</b>, and type the code or paste the link. On a phone, scanning the QR code opens the link.',
  '<b>Compare the numbers.</b> Both screens show the same <b>6-digit number</b>. If they differ, someone else answered: cancel.',
  '<b>Choose Link</b> on the device that manages your list. You can give the new device a name first, such as "Phone".',
  "<b>The new device becomes you.</b> It receives your name, your friends and their secrets, your blocked list and your friends' lists of devices, then starts again as you. Your chats aren't copied: they catch up from your friends, and from your other devices, as each comes online.",
])}
<br>
${figure(
  4,
  'Linking a phone. The number both devices show is worked out from the code and both keys, so only the two devices really talking can show the same one. The whole exchange is in ' +
    helpLink('pigeon://help/protocol/flows/linking-a-device', 'The Pigeon Protocol, A.3') +
    '.',
  pre(`
     COMPUTER (manages your list)                       NEW PHONE
   +-------------------------+                 +-------------------------+
   | Link a Device           |                 | Link to My Other Device |
   | code  ABCD-EFGH         |  -- typed in -> | code  ABCD-EFGH         |
   +-------------------------+                 +-------------------------+
                |<------------ "link me, please" -------------|
                |------------- "you'd be Toms's" ------------>|
   +-------------------------+                 +-------------------------+
   |   check:  482 913       |   same number?  |   check:  482 913       |
   |   [ Link ]   [Cancel]   |                 |   waiting...            |
   +-------------------------+                 +-------------------------+
                |------------- your friends, your name, ----->|
                |              your list of devices           |
                                                     starts again as Toms
`),
)}
${aside(
  'Good to know',
  'A device gets your name and settings when it is linked. Afterwards, a new name or personal message on one of your devices reaches the others when they next meet; settings are not kept in step. If you have a great many friends, a few hundred or more, the link is refused before anything changes, because everything has to travel in one message.',
)}

<h2>Seeing and removing devices</h2>
${steps([
  'Choose <b>File</b>, <b>My Devices</b>. You see every device on your list, which one you are using, and which one manages the list.',
  'If a device is lost or stolen, choose <b>Remove...</b> beside it, on the device that manages your list.',
  'The removal is signed into your list and reaches your other devices through a room only your own devices share, even with no friend online. Friends learn of it in your private rooms.',
])}
<br>
<p>A removal is for good: that device can never be added to your list again. It stops talking and says it was removed. What it sent before it was removed still counts, so a device linked later can catch up with no gaps; nothing it sends afterwards is taken.</p>
${aside(
  'Keep it safe',
  "Only the device that manages your list can link or remove devices, so a stolen phone can do nothing to your list. If the managing device itself is lost, your other devices go on working, but the list can't change until you use your " +
    helpLink(chapterAddress('recovery-key'), 'recovery key') +
    '.',
  '#fde8e4',
)}

<h2>A copied browser</h2>
<p>If you copy a browser's whole profile to another computer, the copy holds the same device key as the original. Each time Pigeon starts it picks a random number for that run, so when a device hears itself speaking with another number, it knows it is open somewhere else too, and offers to <b>Make This a New Device</b>. Opening Pigeon in a second tab of the same browser is not a copy: only one tab runs the Messenger at a time.</p>
`
