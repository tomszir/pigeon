// The Pigeon Messenger main window: you, your friends, and the ways to add one.
import { createSignal, Show } from 'solid-js'
import { ContactList } from '../../../ui/contact-list/contact-list.tsx'
import { brand, tango } from '../../../ui/icons/icons.ts'
import { MenuBar } from '../../../ui/menu-bar/menu-bar.tsx'
import { StatusBar } from '../../../ui/status-bar/status-bar.tsx'
import { Tooltip } from '../../../ui/tooltip/tooltip.tsx'
import { SAMPLE_GROUPS, SAMPLE_SELF, sampleConversation } from '../sample/sample.ts'
import styles from './buddy-list.module.css'

export interface BuddyListProps {
  /** Show the board's sample friends instead of the real, empty list. */
  sample: boolean
  onShowSample: () => void
  onOpenConversation: (contactId: string) => void
  onAbout: () => void
  onClose: () => void
}

export function BuddyList(props: BuddyListProps) {
  const [selected, setSelected] = createSignal<string | undefined>(undefined)
  const open = (id: string) => {
    if (props.sample && sampleConversation(id) !== undefined) props.onOpenConversation(id)
  }

  return (
    <>
      <MenuBar
        label="Pigeon Messenger"
        menus={[
          { label: '&File', entries: [{ label: 'C&lose', onSelect: props.onClose }] },
          { label: '&Contacts', entries: [{ label: '&Add a Friend...', disabled: true }] },
          {
            label: '&Actions',
            entries: [
              {
                label: '&Show the sample',
                disabled: props.sample,
                onSelect: props.onShowSample,
              },
            ],
          },
          { label: '&Help', entries: [{ label: '&About Pigeon', onSelect: props.onAbout }] },
        ]}
      />
      <div class={styles.me}>
        <div class={styles.avatar} aria-hidden="true">
          <Show
            when={props.sample}
            fallback={<img src={brand('pigeon-32')} alt="" width="32" height="32" />}
          >
            <span class={styles.initial}>R</span>
          </Show>
        </div>
        <div class={styles.who}>
          <Show
            when={props.sample}
            fallback={
              <>
                <span>
                  <strong>You</strong> <span class={styles.muted}>(Offline)</span>
                </span>
                <span class={styles.personal}>No name yet</span>
              </>
            }
          >
            <span>
              <strong>{SAMPLE_SELF.name}</strong> <span class={styles.muted}>(Online)</span>
            </span>
            <span class={styles.personal}>{SAMPLE_SELF.personalMessage}</span>
            <span class={styles.letters}>{SAMPLE_SELF.lettersCarried} letters carried</span>
          </Show>
        </div>
      </div>
      <div class={styles.list}>
        <ContactList
          label="Friends"
          groups={props.sample ? SAMPLE_GROUPS : []}
          selected={selected()}
          onSelect={setSelected}
          onOpen={open}
          empty="No friends yet."
        />
        <Show when={!props.sample}>
          <p class={styles.hint}>
            Adding friends arrives in the next version of Pigeon.{' '}
            <button type="button" class={styles.linkButton} onClick={() => props.onShowSample()}>
              See a sample conversation
            </button>
          </p>
        </Show>
      </div>
      <div class={styles.tasks}>
        <Tooltip text="Pairing arrives in the next version.">
          <span class={`${styles.task} ${styles.disabled}`}>
            <img src={tango('contact-new', 22)} alt="" width="22" height="22" />
            Add a Friend
          </span>
        </Tooltip>
        <Tooltip text="Pairing arrives in the next version.">
          <span class={`${styles.task} ${styles.disabled}`}>
            <img src={tango('internet-mail', 22)} alt="" width="22" height="22" />
            Copy invite link
          </span>
        </Tooltip>
      </div>
      <StatusBar
        fields={
          props.sample
            ? [{ content: 'Sample: nothing leaves this tab', grow: true }, { content: 'Direct' }]
            : [{ content: '0 peers', grow: true }, { content: 'Offline' }]
        }
      />
    </>
  )
}
