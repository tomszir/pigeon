// What's on the desktop and in the menu, and what each opens. Content lives in tables here; the
// shell draws it and the apps fill the windows.
import { type Accessor, createSignal } from 'solid-js'
import { About, SOURCE_URL } from '../apps/about/about/about.tsx'
import { BuddyList } from '../apps/messenger/buddy-list/buddy-list.tsx'
import { Conversation } from '../apps/messenger/conversation/conversation.tsx'
import { SAMPLE_SELF, sampleConversation } from '../apps/messenger/sample/sample.ts'
import { Readme } from '../apps/readme/readme/readme.tsx'
import type { ShellProps } from '../shell/shell/shell.tsx'
import type { Launcher, ShellApi, ShellEnv } from '../shell/shell/types.ts'
import { brandIcon, tangoIcon } from '../ui/icons/icons.ts'

export interface Programs extends ShellProps {
  readonly openReadme: () => void
  readonly openMessenger: () => void
  readonly openConversation: (contactId: string) => void
  readonly sample: Accessor<boolean>
}

/** Things that come in later milestones say so, in the world's own voice. */
const LATER = {
  letters: ['Letters is still being built.', 'Sealed letters carried by friends arrive soon.'],
  files: ['Shared Files is still being built.', 'Sending files to friends arrives soon.'],
  explorer: ['Pigeon Explorer is still being built.', 'Browsing pigeon:// pages arrives soon.'],
} as const

export function createPrograms(api: ShellApi, env: ShellEnv, startWithSample: boolean): Programs {
  const [sample, setSample] = createSignal(startWithSample)

  const openAbout = () =>
    api.open('about', {
      title: 'About Pigeon',
      icon: brandIcon('pigeon-16'),
      bounds: { x: 322, y: 200, width: 380, height: 250 },
      controls: { minimize: false },
      content: (window) => <About onClose={window.close} />,
    })

  const openReadme = () =>
    api.open('readme', {
      title: 'Read Me.txt - Pigeon Reader',
      icon: tangoIcon('text-x-generic', 16),
      bounds: { x: 92, y: 16, width: 450, height: 480 },
      resizable: true,
      content: (window) => <Readme onClose={window.close} onAbout={openAbout} />,
    })

  // Each new conversation opens 20px down and right of the last, like the era's cascade, and
  // the first lands where the Desktop board draws it.
  let conversations = 0
  const openConversation = (contactId: string) => {
    const conversation = sampleConversation(contactId)
    if (conversation === undefined) return
    const step = conversations % 5
    conversations += 1
    api.open(`conversation:${contactId}`, {
      title: `${conversation.name} - Conversation`,
      icon: brandIcon('pigeon-16'),
      bounds: { x: 318 + step * 20, y: 116 + step * 20, width: 490, height: 540 },
      resizable: true,
      content: (window) => (
        <Conversation
          conversation={conversation}
          self={SAMPLE_SELF.name}
          onBuzz={window.buzz}
          onClose={window.close}
          onAbout={openAbout}
        />
      ),
    })
  }

  const openMessenger = () =>
    api.open('messenger', {
      title: 'Pigeon',
      icon: brandIcon('pigeon-16'),
      bounds: { x: 818, y: 8, width: 200, height: 600 },
      resizable: true,
      controls: { maximize: false },
      content: (window) => (
        <BuddyList
          sample={sample()}
          onShowSample={() => setSample(true)}
          onOpenConversation={openConversation}
          onAbout={openAbout}
          onClose={window.close}
        />
      ),
    })

  const later = (title: string, text: readonly string[]) => () =>
    api.message({ title, kind: 'information', text })

  const messenger: Launcher = {
    id: 'messenger',
    label: 'Pigeon Messenger',
    description: 'Chat with friends',
    icon16: brandIcon('pigeon-16'),
    icon32: brandIcon('pigeon-32'),
    onOpen: openMessenger,
  }
  const explorer: Launcher = {
    id: 'explorer',
    label: 'Pigeon Explorer',
    description: 'Browse peer pages',
    icon16: tangoIcon('internet-web-browser', 16),
    icon32: tangoIcon('internet-web-browser', 32),
    onOpen: later('Pigeon Explorer', LATER.explorer),
  }
  const readme: Launcher = {
    id: 'readme',
    label: 'Read Me',
    icon16: tangoIcon('text-x-generic', 16),
    icon32: tangoIcon('text-x-generic', 32),
    onOpen: openReadme,
  }
  const addFriend: Launcher = {
    id: 'add-friend',
    label: 'Add a Friend...',
    icon16: tangoIcon('contact-new', 16),
    icon32: tangoIcon('contact-new', 32),
    onOpen: () => undefined,
    disabled: true,
  }
  const letters: Launcher = {
    id: 'letters',
    label: 'Letters',
    icon16: tangoIcon('internet-mail', 16),
    icon22: tangoIcon('internet-mail', 22),
    icon32: tangoIcon('internet-mail', 32),
    onOpen: later('Letters', LATER.letters),
  }
  const files: Launcher = {
    id: 'files',
    label: 'Shared Files',
    icon16: tangoIcon('folder', 16),
    icon22: tangoIcon('folder', 22),
    icon32: tangoIcon('folder', 32),
    onOpen: later('Shared Files', LATER.files),
  }
  const source: Launcher = {
    id: 'source',
    label: 'Source Code',
    icon16: tangoIcon('internet-web-browser', 16),
    icon22: tangoIcon('internet-web-browser', 22),
    icon32: tangoIcon('internet-web-browser', 32),
    onOpen: () => env.openLink(SOURCE_URL),
  }
  const trash: Launcher = {
    id: 'trash',
    label: 'Trash',
    icon16: tangoIcon('user-trash', 16),
    icon32: tangoIcon('user-trash', 32),
    onOpen: later('Trash', ['The Trash is empty.']),
  }
  const settings: Launcher = {
    id: 'settings',
    label: 'Settings',
    icon16: tangoIcon('preferences-system', 16),
    icon22: tangoIcon('preferences-system', 22),
    icon32: tangoIcon('preferences-system', 32),
    onOpen: api.openDisplayProperties,
  }
  const help: Launcher = {
    id: 'help',
    label: 'Help',
    icon16: tangoIcon('help-browser', 16),
    icon22: tangoIcon('help-browser', 22),
    icon32: tangoIcon('help-browser', 32),
    onOpen: openReadme,
  }
  const about: Launcher = {
    id: 'about',
    label: 'About Pigeon',
    icon16: brandIcon('pigeon-16'),
    icon32: brandIcon('pigeon-32'),
    onOpen: openAbout,
  }

  return {
    desktopIcons: [messenger, { ...readme, label: 'Read Me.txt' }, letters, files, source, trash],
    quickLaunch: [messenger, readme],
    menu: {
      programs: [messenger, explorer, readme, addFriend],
      places: [{ ...letters, label: 'My Letters' }, files, source],
      tools: [settings, help],
      all: [about, explorer, messenger, readme, settings],
    },
    openReadme,
    openMessenger,
    openConversation,
    sample,
  }
}
