/** @jsxImportSource @pigeon/pigeonhtml */
// Chapter 5: the recovery key (docs/protocol.md, Devices).

import { Pre } from '../page/page.pigeon.tsx'
import { Aside, chapterAddress, Figure, Steps } from './frame.pigeon.tsx'

export const RECOVERY_KEY = (
  <>
    <p class="lead">
      <i>
        Your recovery key is a key you keep on paper, or in a file, and never on a device. With it
        you can come back as yourself even if every device you had is gone.
      </i>
    </p>

    <h2>What it does</h2>
    <p>
      The recovery key outranks every device. It never sends messages or joins rooms. It does one
      thing: it signs a <b>recovery</b>, which says which device manages your list from now on,
      which devices stay on it, and what your next recovery key is. Every other device stops being
      yours. Your fingerprint and your pigeon don't change, so your friends still know you.
    </p>
    <p>
      Each recovery starts a new chapter of your list, called an <b>epoch</b>. Only the newest
      chapter says who is on your list; the older ones only say who was once yours, and until when.
    </p>

    <h2>Making your key</h2>
    <Steps
      items={[
        <>
          <b>Right after you choose your name</b>, Pigeon opens <b>Make a Recovery Key</b>. You can
          choose <b>Later</b>: a balloon reminds you once on a later visit, and <b>File</b>,{' '}
          <b>Make a Recovery Key</b> stays on your first device until you have one.
        </>,
        <>
          <b>Pigeon shows the key once</b>, as 28 groups of four letters and digits. Print it or
          copy it down. You can also save it as a file sealed with a passphrase you choose.
        </>,
        <>
          <b>Say you've kept it.</b> Only then does your list take the key. Pigeon never keeps a
          copy, so a key nobody wrote down would be one nobody could ever replace.
        </>,
      ]}
    />
    <br />
    <Aside title="Keep it safe" color="#fde8e4">
      Whoever has your recovery key can take over your Pigeon, and the only way to cancel a key is
      to use it. Keep the paper somewhere safe, and keep a sealed file and its passphrase apart.
      Lose both copies and you can never make another, though your devices go on as before.
    </Aside>
    <p class="small">
      A recovery key needs a browser that can make the newer kind of key Pigeon uses for it
      (Ed25519). Older browsers, such as Safari before version 17, can't, and say so.
    </p>

    <h2>Coming back with every device lost</h2>
    <Steps
      items={[
        <>
          <b>Open Pigeon in a new browser</b>, one with nobody on it yet and no friends.
        </>,
        <>
          <b>Choose File, Recover My Pigeon</b>, and type your key or open its file.
        </>,
        <>
          <b>Keep your next key.</b> Using a key replaces it, so Pigeon shows your next one first
          and goes on only once you say you have kept it.
        </>,
        <>
          <b>Pigeon signs the recovery</b> and starts again as you. Choose your name.
        </>,
        <>
          <b>Pair with a friend who knew you</b>, with an invite as when you first met. Their Pigeon
          sees it is you, keeps your chat and the name they gave you, and hands back your whole list
          of devices. From then on you can link devices and make new friends again.
        </>,
      ]}
    />
    <br />
    <Figure
      number={5}
      caption={
        <>
          Coming back. The new browser has only its own chapter of your list, which nobody can check
          on its own. The first friend who knew you checks it against the list they already keep,
          and hands the whole list back. In full:{' '}
          <a href="pigeon://help/protocol/flows/recovery-with-every-device-lost">
            The Pigeon Protocol, A.5
          </a>
          .
        </>
      }
    >
      <Pre
        text={`
     NEW BROWSER                    MIKA                     LOST LAPTOP
   (your key typed in)      (keeps your old list)        (maybe a thief's)
          |                          |                          |
   signs a recovery:                 |                          |
   "this browser now,                |                          |
    next key K2"                     |                          |
          |---- pair again --------->|                          |
          |                   "it follows on from               |
          |                    the list I keep: it's            |
          |                    Toms, same chat"                 |
          |<--- your whole list -----|                          |
          |                          |<---- "it's Toms" --------|
          |                          |  refused: the recovery   |
          |                          |  took it off the list    |
`}
      />
    </Figure>
    <p>
      Until one old friend has seen the recovery, keep your <b>old</b> key as well as the new one:
      the new one is worth nothing until a friend has seen it. If you saved your data to a file,{' '}
      <b>Import My Data</b> brings your friends back in one go; see{' '}
      <a href={chapterAddress('saving-your-data')}>Saving Your Data</a>.
    </p>

    <h2>When one device is stolen</h2>
    <p>
      If you still have a device, choose <b>File</b>, <b>Use My Recovery Key</b> on it. That device
      becomes the one that manages your list, as after a theft. Untick <b>Keep my other devices</b>{' '}
      if one was stolen, and every device but this one is off your list. Your key is replaced with a
      new one: keep it before going on.
    </p>
    <p>
      This is also how you replace a key you think someone has seen. Once your friends and devices
      have seen the newer chapter, the old key can't undo it.
    </p>

    <h2>What your friends see</h2>
    <ul>
      <li>
        The same you: your fingerprint, your pigeon, your chat and the name they gave you all stay.
      </li>
      <li>Pairing again gives the two of you a new secret, and your private room moves with it.</li>
      <li>
        Until a friend has seen your recovery, their Pigeon still trusts your lost devices. Pairing
        again closes that gap, so do it soon.
      </li>
      <li>
        Messages your lost devices sent before the recovery still count. Nothing they send
        afterwards is taken.
      </li>
      <li>
        A friend on a Pigeon from before recovery keys has to update before they hear your recovered
        device.
      </li>
    </ul>
  </>
)
