// Chapter 2: invites, links, QR codes and fingerprints (docs/protocol.md, Pairing).

import { pre } from '../page/page.ts'
import { aside, chapterAddress, figure, flow, helpLink, steps } from './frame.ts'

export const ADDING_A_FRIEND = `
<p class="lead"><i>There is no directory of everyone on Pigeon. You add a friend by giving them an invite, and Pigeon checks that the person who answers is the one you meant.</i></p>

<h2>Two kinds of invite</h2>
<p>An <b>invite link</b> waits at your Lighthouses, so a friend can use it while you're offline, and one link can bring in several friends. A <b>live code</b> works only while you're both online, but it's short enough to read out. Add a Friend has a tab for each, and a third, <b>Have an Invite?</b>, for opening one a friend sent you.</p>

<h2>Invite links</h2>
<p>Choose how long the link <b>lasts</b> (1 hour, 1 day, 7 days or 30 days) and how many people it's <b>for</b> (1, 5, 10 or 25), then <b>Make Link</b>. Pigeon copies it for you, with a line above it saying it's from you ("Toms invites you to Pigeon!"). Send it however you like. The link itself never says who made it, so a chat's preview of it shows only Pigeon.</p>
<p>A friend who opens it sees your name and fingerprint, checked against the link, and chooses <b>Ask to Be Friends</b>. Their request waits at your Lighthouses, sealed so only your devices can read it. The next time you open Pigeon it shows under the link in Add a Friend, with their name and fingerprint, and <b>Add</b> and <b>Decline</b>. Nobody is added until you say so, even if the link was forwarded further than you meant: anyone with it can call themselves anything, so check the fingerprint with them some other way. Once you add them, they're your friend the next time their Pigeon looks, and neither of you ever had to be online at the same time.</p>
<p>A link closes when its places are used up, when it runs out, or when you choose <b>Delete</b>. Everyone who has the link can see your name, your list of devices and your Lighthouses, and how many requests came, but never who sent them.</p>

<h2>Quick codes</h2>
<p>The <b>Quick Code</b> tab shows a live code and its QR code. It changes by itself after each use and every 30 minutes. It comes in three forms, and they all carry the same thing:</p>
<table width="100%" cellpadding="6" cellspacing="0" border="1">
<tr bgcolor="#dde6f3"><th align="left">Form</th><th align="left">Looks like</th><th align="left">Best for</th></tr>
<tr><td valign="top"><b>Code</b></td><td valign="top"><tt>K7RT-VP2-BXQ</tt>: 10 letters and digits</td><td valign="top">reading out over the phone</td></tr>
<tr><td valign="top"><b>Link</b></td><td valign="top"><tt>https://pigeon.tomszir.com/#i/...</tt></td><td valign="top">what the QR code holds; to send an invite, make an invite link instead</td></tr>
<tr><td valign="top"><b>QR code</b></td><td valign="top">a square of dots</td><td valign="top">a friend in the same room with a phone</td></tr>
</table>
<br>
<p>The first four letters of the code say which room to meet in; anyone can see those. The rest is a password that never leaves your friend's computer as it is: the two Pigeons prove to each other that they hold the same one, and someone who only watches can't work it out. The link and the QR code hold a much longer secret instead of the whole code, and also <b>your fingerprint</b>; they meet in a room only someone with the link can find. A live code pairs one friend, once, within <b>30 minutes</b>, and only while Pigeon is open on your side.</p>

<h2>Step by step</h2>
${steps([
  '<b>Make an invite.</b> In Pigeon Messenger, choose <b>Contacts</b>, <b>Add a Friend</b>, <b>Quick Code</b>. Pigeon shows your code and its QR code.',
  '<b>Share it.</b> Show the QR code, or read the code out. Keep Add a Friend open: your Pigeon is waiting in a room named after the code.',
  '<b>Your friend opens it.</b> They scan the QR code, or choose Add a Friend, <b>Have an Invite?</b> and type the code. Capital or small letters both work, the dash is optional, and 0, 1 and 8 are read as O, L and B, so a smudged code still works.',
  '<b>Their Pigeon looks for yours.</b> Their window shows each step as it really happens: <i>Reaching the relays</i>, <i>Looking for whoever made</i> the code, then <i>Asking who they are</i>. A paper plane flies along a dotted line while it waits, and a countdown shows when it will give up.',
  "<b>The two Pigeons check the code.</b> Each proves to the other that it holds the same code, over the very connection they're on, so nobody can sit in between. A wrong code goes no further, and your window says someone typed a wrong one. After five wrong tries Pigeon stops the code, in case someone is guessing.",
  '<b>They check who answered.</b> They see your name and your fingerprint. If they opened a link, Pigeon has already compared the fingerprint with the one in the link and refuses anyone else. If they typed the code, they compare the fingerprint with the one on your screen. Then they choose <b>Ask to Be Friends</b>.',
  '<b>You choose Add.</b> Their name, fingerprint and bird show in your Quick Code tab, with <b>Add</b> and <b>Decline</b>. Anyone who saw the code could ask, with any name, so check the fingerprint with theirs. Your Pigeon then makes a secret only the two of you will ever hold, sealed so only their computer can open it. Both of you go straight to your new conversation, which begins with the day and time you became friends.',
])}
<br>
${figure(
  2,
  'The invite handshake. The two Pigeons prove they hold the same code, names go each way, you both decide, and only then does your Pigeon hand over the secret. The full drawing is in ' +
    helpLink('pigeon://help/protocol/flows/invite-handshake', 'The Pigeon Protocol, A.1') +
    '.',
  pre(`
     YOU                      the invite's room                 MIKA
      |                                                           |
      |<=========== "Do we hold the same code?" =================>|
      |             (proved both ways, over this connection)      |
      |------------ "Hello, I'm Toms." (with fingerprint) ------->|
      |                                                           |
      |                                    Mika checks the name   |
      |                                    and the fingerprint,   |
      |                                    then asks              |
      |<----------- "I'm Mika. Please add me." -------------------|
      |                                                           |
   you check Mika's fingerprint and choose Add                    |
      |------------ "Here's our secret." (sealed to Mika) ------->|
      |                                                           |
   the code is used up; from now on you meet in your private room
`),
)}

<h2>What the fingerprint is for</h2>
<p>A typed code is short, and anyone who saw it could try to answer first: they'd know the code, so the check that it's right lets them through. Your fingerprint is 16 characters worked out from your key and spelled in groups of four, and someone else's key won't give the same one. That's why you both see each other's before anyone is added.</p>
${flow([
  { label: 'your key', note: 'made by your computer' },
  { label: 'fingerprint', note: '<tt>3F2A 9C1B 77D0 E415</tt>' },
  { label: 'compared', note: 'on screen or out loud' },
])}
<br>
${aside(
  'Watch out',
  "If the fingerprint your friend sees doesn't match yours, or the one beside their request doesn't match theirs, don't add them. Choose Decline, and make a new invite if you need to.",
  '#fde8e4',
)}

<h2>When it doesn't connect</h2>
<ul>
<li><b>Nobody there yet.</b> Pigeon must be open on your side, with the invite still showing, and the code must be right.</li>
<li><b>Nobody answered.</b> An invite works once, for 30 minutes. Ask for a new one.</li>
<li><b>The code is wrong.</b> Check it and type it again. After five wrong tries the code stops working and your friend needs a new one. If the right code keeps being called wrong, someone else may be answering in your friend's place: scan their QR code or open their link instead.</li>
<li><b>It's from an older Pigeon.</b> Codes used to have 8 letters. A Pigeon open since before the change can't pair with this one: your friend reloads Pigeon and makes a new code.</li>
<li><b>They didn't add you.</b> Your friend has to choose Add in their Quick Code tab within 3 minutes.</li>
<li><b>Behind a strict network.</b> Pigeon goes through a relay when it has to. See ${helpLink(chapterAddress('private-rooms'), 'Your Private Rooms')}.</li>
</ul>

<h2>Removing and blocking</h2>
<p>Removing a friend deletes them and your chat from this browser and tells their Pigeon, now or the next time they're online. Their Pigeon keeps the chat to read, marks you as having removed them, and stops talking to you. You can become friends again by pairing again.</p>
<p>Blocking someone also keeps them out: their requests through your codes never show, and an invite of theirs you open is refused. The names you give friends and the friends you mute are yours alone and never leave this browser.</p>
`
