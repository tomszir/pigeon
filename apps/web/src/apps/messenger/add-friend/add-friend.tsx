// Add a Friend: share your invite link or its QR code, or open a link a friend sent. Opening
// one shows who it's from and their fingerprint before anything is sent.
import { decodeInvite, formatFingerprint, type Invite, type PeerId } from '@pigeon/core'
import { createSignal, Match, onMount, Show, Switch } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { MessageBox } from '../../../ui/message-box/message-box.tsx'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { ProfileForm } from '../profile-form/profile-form.tsx'
import { QrCode } from '../qr-code/qr-code.tsx'
import type { Messenger } from '../service/service.ts'
import styles from './add-friend.module.css'

/** How long to wait for the inviter's Pigeon to answer. */
export const ANSWER_TIMEOUT_MS = 45_000

export interface AddFriendProps {
  messenger: Messenger
  /** A link opened from the address bar. */
  incoming?: Invite | undefined
  copyText: (text: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  onOpenConversation: (id: PeerId) => void
  onClose: () => void
}

type View =
  | { readonly kind: 'share' }
  | { readonly kind: 'confirm'; readonly invite: Invite; readonly fingerprint: string }
  | { readonly kind: 'waiting'; readonly invite: Invite }
  | { readonly kind: 'paired'; readonly id: PeerId; readonly handle: string }
  | { readonly kind: 'failed'; readonly handle: string }

/** Reads an invite out of whatever was pasted: the whole link or just the part after '#'. */
export function readInvite(text: string) {
  const trimmed = text.trim()
  const hash = trimmed.indexOf('#')
  return decodeInvite(hash < 0 ? trimmed : trimmed.slice(hash + 1))
}

export function AddFriend(props: AddFriendProps) {
  const [view, setView] = createSignal<View>({ kind: 'share' })
  const [pasted, setPasted] = createSignal('')
  const [pasteError, setPasteError] = createSignal('')
  const [copied, setCopied] = createSignal('')
  let cancel: (() => void) | undefined

  const hasName = () => props.messenger.profile().handle !== ''

  const confirm = async (invite: Invite) => {
    if (invite.id === props.messenger.self) {
      setPasteError("That's your own invite link. Send it to a friend instead.")
      return
    }
    if (props.messenger.friend(invite.id) !== undefined) {
      props.onOpenConversation(invite.id)
      props.onClose()
      return
    }
    setView({
      kind: 'confirm',
      invite,
      fingerprint: await props.messenger.fingerprintOf(invite.id),
    })
  }

  onMount(() => {
    if (props.incoming !== undefined) void confirm(props.incoming)
    else if (hasName() && props.messenger.invite() === undefined) void props.messenger.newInvite()
  })

  const open = () => {
    const invite = readInvite(pasted())
    if (!invite.ok) {
      setPasteError("That doesn't look like a Pigeon invite link.")
      return
    }
    setPasteError('')
    void confirm(invite.value)
  }

  const pair = async (invite: Invite) => {
    setView({ kind: 'waiting', invite })
    const stopped = new Promise<void>((resolve) => {
      cancel = resolve
      void props.sleep(ANSWER_TIMEOUT_MS).then(resolve)
    })
    const result = await props.messenger.accept(invite, stopped)
    if (view().kind !== 'waiting') return
    setView(
      result.ok
        ? { kind: 'paired', id: result.friend.id, handle: result.friend.handle }
        : { kind: 'failed', handle: invite.handle },
    )
  }

  const stopWaiting = () => {
    cancel?.()
    setView({ kind: 'share' })
  }

  const copy = async () => {
    const link = props.messenger.inviteLink()
    if (link === undefined) return
    setCopied((await props.copyText(link)) ? 'Copied.' : 'Select the link and copy it.')
  }

  const saveName = (handle: string, message: string) =>
    void props.messenger.setProfile({ ...props.messenger.profile(), handle, message }).then(() => {
      if (props.messenger.invite() === undefined) void props.messenger.newInvite()
    })

  return (
    <div class={styles.addFriend}>
      <Switch>
        <Match when={!hasName()}>
          <ProfileForm handle="" message="" first onSave={saveName} />
        </Match>
        <Match when={view().kind === 'share'}>
          <GroupBox legend="Invite a friend">
            <div class={styles.share}>
              <Show
                when={props.messenger.inviteLink()}
                fallback={
                  <div class={styles.column}>
                    <p class={styles.text}>Your last link has been used.</p>
                    <Button
                      label="&Make a new link"
                      onClick={() => void props.messenger.newInvite()}
                    />
                  </div>
                }
              >
                {(link) => (
                  <>
                    <QrCode text={link()} label="Invite link as a QR code" />
                    <div class={styles.column}>
                      <p class={styles.text}>
                        Send this link to one friend, or let them scan the code. It works once,
                        while Pigeon is open here.
                      </p>
                      <TextField label="Invite link" labelHidden value={link()} readOnly />
                      <div class={styles.row}>
                        <Button label="&Copy link" isDefault onClick={() => void copy()} />
                        <Button
                          label="&New link"
                          onClick={() => {
                            setCopied('')
                            void props.messenger.newInvite()
                          }}
                        />
                        <span class={styles.note} aria-live="polite">
                          {copied()}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </Show>
            </div>
            <p class={styles.fingerprint}>
              Your fingerprint: <code>{formatFingerprint(props.messenger.selfFingerprint)}</code>
            </p>
          </GroupBox>
          <GroupBox legend="Got an invite?">
            <form
              class={styles.column}
              onSubmit={(event) => {
                event.preventDefault()
                open()
              }}
            >
              <TextField
                label="&Paste a friend's link:"
                value={pasted()}
                onInput={(text) => {
                  setPasted(text)
                  setPasteError('')
                }}
              />
              <div class={styles.row}>
                <Button label="&Open" type="submit" disabled={pasted().trim() === ''} />
                <span class={styles.error} role="alert">
                  {pasteError()}
                </span>
              </div>
            </form>
          </GroupBox>
        </Match>
        <Match when={view().kind === 'confirm' && (view() as Extract<View, { kind: 'confirm' }>)}>
          {(current) => (
            <MessageBox
              kind="information"
              buttons={[
                { label: '&Pair', isDefault: true, onClick: () => void pair(current().invite) },
                { label: 'Cancel', onClick: () => setView({ kind: 'share' }) },
              ]}
            >
              <p>
                <strong>{current().invite.handle}</strong> invited you to be friends.
              </p>
              <p>
                Their fingerprint is <code>{formatFingerprint(current().fingerprint)}</code>. If you
                can, check it matches what {current().invite.handle} sees on their screen.
              </p>
            </MessageBox>
          )}
        </Match>
        <Match when={view().kind === 'waiting' && (view() as Extract<View, { kind: 'waiting' }>)}>
          {(current) => (
            <MessageBox kind="information" buttons={[{ label: 'Cancel', onClick: stopWaiting }]}>
              <p>
                Waiting for {current().invite.handle}'s Pigeon to answer... Their Pigeon has to be
                open.
              </p>
            </MessageBox>
          )}
        </Match>
        <Match when={view().kind === 'paired' && (view() as Extract<View, { kind: 'paired' }>)}>
          {(current) => (
            <MessageBox
              kind="information"
              buttons={[
                {
                  label: '&Say hello',
                  isDefault: true,
                  onClick: () => {
                    props.onOpenConversation(current().id)
                    props.onClose()
                  },
                },
                { label: 'Close', onClick: props.onClose },
              ]}
            >
              <p>You and {current().handle} are now friends.</p>
            </MessageBox>
          )}
        </Match>
        <Match when={view().kind === 'failed' && (view() as Extract<View, { kind: 'failed' }>)}>
          {(current) => (
            <MessageBox
              kind="warning"
              buttons={[
                { label: '&Back', isDefault: true, onClick: () => setView({ kind: 'share' }) },
                { label: 'Close', onClick: props.onClose },
              ]}
            >
              <p>
                {current().handle}'s Pigeon didn't answer. Links work once, and only while Pigeon is
                open on their side. Ask {current().handle} to keep Pigeon open, or to send a new
                link.
              </p>
            </MessageBox>
          )}
        </Match>
      </Switch>
    </div>
  )
}
