// A person's pixel pigeon (docs/design.md, Avatars) in a white frame, the way 2003 drew a
// display picture. It draws traits it's given; working them out from an id is the Messenger's.
import { type AvatarTraits, avatarSvg, describeAvatar, drawAvatar } from '@pigeon/core'
import { createMemo, type JSX, Show } from 'solid-js'
import { classes } from '../classes/classes.ts'
import type { Icon } from '../icons/icons.ts'
import styles from './avatar.module.css'

/** The bird as an image address, for an `<img>` or anywhere that takes an icon. */
export const avatarSrc = (traits: AvatarTraits, size = 32): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(drawAvatar(traits), size))}`

/** The bird as an icon, for a balloon. */
export const avatarIcon = (traits: AvatarTraits, size = 32): Icon => ({
  src: avatarSrc(traits, size),
  size,
})

export interface AvatarProps {
  /** Undefined while the traits are still being worked out: an empty frame holds the place. */
  traits: AvatarTraits | undefined
  /** The picture's width and height in CSS pixels; the frame adds 6. */
  size: number
  /** Whose bird it is, for the alt text: "Mika's pigeon: A slate pigeon...". */
  name: string
  /** Beside the person's name already, so a screen reader skips it. */
  decorative?: boolean
  /** Without its frame, for a place that draws its own. */
  bare?: boolean
  /** A dot in the corner for how they are; an offline bird is greyed too. */
  status?: 'online' | 'away' | 'busy' | 'offline' | undefined
  /** Shown in the frame while there's no bird: who's at the far end before they answer. */
  placeholder?: JSX.Element
}

export function Avatar(props: AvatarProps) {
  const src = createMemo(() => {
    const traits = props.traits
    if (traits === undefined) return undefined
    return avatarSrc(traits, props.size)
  })
  const outer = () => props.size + (props.bare ? 0 : 6)
  return (
    <span
      class={classes(
        props.bare ? styles.bare : styles.avatar,
        props.status === 'offline' && styles.offline,
      )}
      style={{ width: `${outer()}px`, height: `${outer()}px` }}
    >
      <Show when={src() !== undefined} fallback={props.placeholder}>
        <img
          src={src()}
          alt={
            props.decorative
              ? ''
              : `${props.name}'s pigeon: ${describeAvatar(props.traits as AvatarTraits)}`
          }
          // A decorative bird adds nothing to the name of what it sits in, not even a tooltip.
          title={props.decorative ? undefined : describeAvatar(props.traits as AvatarTraits)}
          width={props.size}
          height={props.size}
        />
      </Show>
      <Show when={props.status !== undefined}>
        <span
          class={classes(styles.status, props.status && styles[props.status])}
          aria-hidden="true"
        />
      </Show>
    </span>
  )
}
