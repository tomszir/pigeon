/** @jsxImportSource @pigeon/pigeonhtml */
// Chapter 6: Export My Data, Import My Data and Save Conversation As (docs/protocol.md, Your
// data in a file).

import { Pre } from '../page/page.pigeon.tsx'
import { Aside, Figure, Steps } from './frame.pigeon.tsx'

export const SAVING_YOUR_DATA = (
  <>
    <p class="lead">
      <i>
        Everything Pigeon knows about your friends and chats lives in this browser. You can seal a
        copy of it into a file, to keep or to bring to another device of yours.
      </i>
    </p>

    <h2>Saving a sealed file</h2>
    <Steps
      items={[
        <>
          In Pigeon Messenger, choose <b>File</b>, <b>Export My Data</b>.
        </>,
        <>
          Choose a <b>passphrase</b> and type it twice. Pick a long one: the file is only as safe as
          the passphrase.
        </>,
        <>
          Choose <b>Save as File</b>. Pigeon writes a text file named like{' '}
          <tt>Pigeon data 2026-11-25.txt</tt>.
        </>,
      ]}
    />
    <br />
    <Figure
      number={6}
      caption={
        <>
          What goes in the file, and what doesn't. The sealed part can only be opened with your
          passphrase.
        </>
      }
    >
      <Pre
        text={`
   +------------------------------------------------------------+
   |  Pigeon data 2026-11-25.txt                                |
   |                                                            |
   |  pigeon-sealed:v2:...  <- one long sealed line             |
   |  +------------------------------------------------------+  |
   |  | IN IT:      your name and settings, your friends     |  |
   |  |             and their secrets, everyone you blocked, |  |
   |  |             your friends' lists of devices, and      |  |
   |  |             every chat                               |  |
   |  | NOT IN IT:  any key, your own list of devices        |  |
   |  +------------------------------------------------------+  |
   +------------------------------------------------------------+
`}
      />
    </Figure>
    <p>
      The file is sealed with your passphrase, made slow and memory-hungry to guess on purpose, so a
      stranger who finds it can't read it. A file saved by an older Pigeon still opens. Guard both:
      the file holds every chat you have. It also holds each friend's secret, which lets whoever
      opens it into your private meeting places with that friend, where they can see when your
      friend is online, their name and devices, and their address. They still can't read or send
      your messages there: that takes a key that never leaves your device.
    </p>

    <h2>Opening it on a device of yours</h2>
    <Steps
      items={[
        <>
          On a device that is already you, linked or recovered, choose <b>File</b>,{' '}
          <b>Import My Data</b>.
        </>,
        <>Choose the file and type its passphrase.</>,
        <>
          Pigeon adds your chats' messages to the ones it has, with the same checks it uses when
          chats catch up, and adds any friends and blocks this device is missing. Where both have a
          friend, it keeps its own. It takes your name and settings only if this device has no name
          yet.
        </>,
        <>Pigeon starts again with everything in.</>,
      ]}
    />
    <br />
    <Aside title="Good to know">
      An export file only opens on a device of the same Pigeon. Someone else's file, or one from
      before this device became you, is refused. It isn't a way to give your friends to someone
      else.
    </Aside>

    <h2>Saving one conversation as text</h2>
    <p>
      To keep a single chat to read later, open it and choose <b>File</b>,{' '}
      <b>Save Conversation As</b>. Pigeon writes it as a plain text file anyone can read, with
      nothing sealed.
    </p>
  </>
)
