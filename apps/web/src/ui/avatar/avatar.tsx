// A person's pixel pigeon (docs/design.md, Avatars) in a white frame, the way 2003 drew a
// display picture. It draws traits it's given; working them out from an id is the Messenger's.
import { type AvatarTraits, avatarSvg, describeAvatar, drawAvatar } from '@pigeon/core'
import { createMemo, Show } from 'solid-js'
import styles from './avatar.module.css'

export interface AvatarProps {
  /** Undefined while the traits are still being worked out: an empty frame holds the place. */
  traits: AvatarTraits | undefined
  /** The picture's width and height in CSS pixels; the frame adds 6. */
  size: number
  /** Whose bird it is, for the alt text: "Mika's pigeon: A slate pigeon...". */
  name: string
}

export function Avatar(props: AvatarProps) {
  const src = createMemo(() => {
    const traits = props.traits
    if (traits === undefined) return undefined
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg(drawAvatar(traits)))}`
  })
  return (
    <span
      class={styles.avatar}
      style={{ width: `${props.size + 6}px`, height: `${props.size + 6}px` }}
    >
      <Show when={src()}>
        {(url) => (
          <img
            src={url()}
            alt={`${props.name}'s pigeon: ${describeAvatar(props.traits as AvatarTraits)}`}
            title={describeAvatar(props.traits as AvatarTraits)}
            width={props.size}
            height={props.size}
          />
        )}
      </Show>
    </span>
  )
}
