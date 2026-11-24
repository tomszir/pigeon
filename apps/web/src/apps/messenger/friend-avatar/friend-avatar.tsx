// A friend's (or your own) pixel pigeon: the Messenger works the traits out from the id, and
// ui/avatar draws them. Version 1 is the only drawing so far, so the id is all it needs.
import type { PeerId } from '@pigeon/core'
import { createResource } from 'solid-js'
import { Avatar } from '../../../ui/avatar/avatar.tsx'
import type { Messenger } from '../service/service.ts'

export function FriendAvatar(props: {
  messenger: Pick<Messenger, 'avatarOf'>
  id: PeerId
  name: string
  size: number
}) {
  const [traits] = createResource(
    () => props.id,
    (id) => props.messenger.avatarOf(id),
  )
  return <Avatar traits={traits()} size={props.size} name={props.name} />
}
