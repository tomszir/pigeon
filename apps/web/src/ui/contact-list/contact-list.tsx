// The buddy list: contacts in collapsible groups, each with a presence figure.
import { createSignal, For, Show } from 'solid-js'
import { classes } from '../classes/classes.ts'
import { brand, tango } from '../icons/icons.ts'
import styles from './contact-list.module.css'

export type Presence = 'online' | 'away' | 'offline' | 'peer' | 'bot'

export interface ContactRow {
  readonly id: string
  readonly name: string
  readonly presence: Presence
  /** Shown after the name in grey: "(Away)", "- 2 letters". */
  readonly note?: string
}

export interface ContactGroup {
  readonly id: string
  readonly label: string
  readonly contacts: readonly ContactRow[]
}

/** Which figure stands for which presence. Always-on peers and bots get their own marks. */
const figures: Record<Presence, () => string> = {
  online: () => brand('presence-16-online'),
  away: () => brand('presence-16-away'),
  offline: () => brand('presence-16-offline'),
  peer: () => tango('network-transmit-receive', 16),
  bot: () => tango('face-smile', 16),
}

export interface ContactListProps {
  label: string
  groups: readonly ContactGroup[]
  selected?: string | undefined
  onSelect?: ((id: string) => void) | undefined
  onOpen?: ((id: string) => void) | undefined
  /** Shown when there are no contacts at all. */
  empty?: string | undefined
}

export function ContactList(props: ContactListProps) {
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const toggle = (id: string) => {
    const next = new Set(collapsed())
    if (!next.delete(id)) next.add(id)
    setCollapsed(next)
  }
  const total = () => props.groups.reduce((sum, group) => sum + group.contacts.length, 0)

  return (
    <section class={styles.contactList} aria-label={props.label}>
      <Show when={total() > 0} fallback={<p class={styles.empty}>{props.empty}</p>}>
        <For each={props.groups}>
          {(group) => {
            const open = () => !collapsed().has(group.id)
            return (
              <div class={styles.section}>
                <button
                  type="button"
                  class={styles.group}
                  aria-expanded={open()}
                  onClick={() => toggle(group.id)}
                >
                  <span class={styles.toggle} aria-hidden="true">
                    {open() ? '-' : '+'}
                  </span>
                  {group.label} ({group.contacts.length})
                </button>
                <Show when={open()}>
                  <div>
                    <For each={group.contacts}>
                      {(contact) => (
                        <button
                          type="button"
                          aria-pressed={props.selected === contact.id}
                          class={classes(
                            styles.row,
                            props.selected === contact.id && styles.selected,
                            contact.presence === 'offline' && styles.offline,
                          )}
                          onClick={() => props.onSelect?.(contact.id)}
                          onDblClick={() => props.onOpen?.(contact.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') props.onOpen?.(contact.id)
                          }}
                        >
                          <img src={figures[contact.presence]()} alt="" width="16" height="16" />
                          <span>
                            {contact.name}
                            <Show when={contact.note}>
                              {(note) => <span class={styles.note}> {note()}</span>}
                            </Show>
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )
          }}
        </For>
      </Show>
    </section>
  )
}
