// The buddy list: contacts in collapsible groups, each with a presence figure.
import type { AvatarTraits } from '@pigeon/core'
import { createSignal, For, Show } from 'solid-js'
import { Avatar } from '../avatar/avatar.tsx'
import { classes } from '../classes/classes.ts'
import { brand, tango } from '../icons/icons.ts'
import { useLayout } from '../layout/layout.ts'
import styles from './contact-list.module.css'

export type Presence = 'online' | 'away' | 'offline' | 'peer' | 'bot'

export interface ContactRow {
  readonly id: string
  readonly name: string
  readonly presence: Presence
  /** Shown after the name in grey: "(Away)", "- 2 letters". */
  readonly note?: string
  /** Their pixel pigeon, when the list shows pictures; undefined while it's worked out. */
  readonly avatar?: AvatarTraits | undefined
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

/** The dot a contact's bird carries in place of their figure. */
const DOT: Record<Presence, 'online' | 'away' | 'offline'> = {
  online: 'online',
  away: 'away',
  offline: 'offline',
  peer: 'online',
  bot: 'online',
}

export interface ContactListProps {
  label: string
  groups: readonly ContactGroup[]
  selected?: string | undefined
  onSelect?: ((id: string) => void) | undefined
  onOpen?: ((id: string) => void) | undefined
  /**
   * Right-click, a long press, or the keyboard's menu key (Shift+F10) on a row, at a point in
   * the page's own pixels.
   */
  onMenu?: ((id: string, at: { x: number; y: number }) => void) | undefined
  /** Shown when there are no contacts at all. */
  empty?: string | undefined
  /** Each row shows the contact's pixel pigeon after their presence figure. */
  pictures?: boolean | undefined
}

export function ContactList(props: ContactListProps) {
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const toggle = (id: string) => {
    const next = new Set(collapsed())
    if (!next.delete(id)) next.add(id)
    setCollapsed(next)
  }
  /** The last press was a finger or pen rather than a mouse. */
  let tapped = false
  /** A long press opened the menu, so the tap that ends it doesn't also open the chat. */
  let pressed: ReturnType<typeof setTimeout> | undefined
  let longPressed = false
  const LONG_PRESS_MS = 500
  const cancelPress = () => {
    clearTimeout(pressed)
    pressed = undefined
  }
  const total = () => props.groups.reduce((sum, group) => sum + group.contacts.length, 0)

  return (
    <section
      class={classes(styles.contactList, useLayout() === 'phone' && styles.phone)}
      aria-label={props.label}
    >
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
                            props.pictures && styles.pictured,
                            props.selected === contact.id && styles.selected,
                            contact.presence === 'offline' && styles.offline,
                          )}
                          onPointerDown={(event) => {
                            tapped = event.pointerType === 'touch' || event.pointerType === 'pen'
                            longPressed = false
                            cancelPress()
                            if (!tapped || props.onMenu === undefined) return
                            const at = { x: event.clientX, y: event.clientY }
                            pressed = setTimeout(() => {
                              longPressed = true
                              props.onSelect?.(contact.id)
                              props.onMenu?.(contact.id, at)
                            }, LONG_PRESS_MS)
                          }}
                          onPointerUp={cancelPress}
                          onPointerCancel={cancelPress}
                          onPointerLeave={cancelPress}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            if (longPressed || props.onMenu === undefined) return
                            props.onSelect?.(contact.id)
                            props.onMenu(contact.id, { x: event.clientX, y: event.clientY })
                          }}
                          onClick={() => {
                            if (longPressed) {
                              longPressed = false
                              tapped = false
                              return
                            }
                            props.onSelect?.(contact.id)
                            // A finger has no double-click: one tap opens, as on a phone.
                            if (tapped) props.onOpen?.(contact.id)
                            tapped = false
                          }}
                          onDblClick={() => props.onOpen?.(contact.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') props.onOpen?.(contact.id)
                            if (
                              props.onMenu !== undefined &&
                              (event.key === 'ContextMenu' ||
                                (event.shiftKey && event.key === 'F10'))
                            ) {
                              event.preventDefault()
                              const box = event.currentTarget.getBoundingClientRect()
                              props.onSelect?.(contact.id)
                              props.onMenu(contact.id, { x: box.left + 24, y: box.bottom })
                            }
                          }}
                        >
                          <Show
                            when={props.pictures}
                            fallback={
                              <img
                                src={figures[contact.presence]()}
                                alt=""
                                width="16"
                                height="16"
                              />
                            }
                          >
                            <Avatar
                              traits={contact.avatar}
                              size={24}
                              name={contact.name}
                              decorative
                              status={DOT[contact.presence]}
                            />
                          </Show>
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
