// The name friends see and an optional personal message. Used for first-run setup and later edits.
import { MAX_HANDLE_LENGTH, MAX_PERSONAL_MESSAGE_LENGTH } from '@pigeon/core'
import { createSignal, Show } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import styles from './profile-form.module.css'

export interface ProfileFormProps {
  handle: string
  message: string
  /** First run: no Cancel, and a line about what the name is for. */
  first: boolean
  onSave: (handle: string, message: string) => void
  onCancel?: () => void
}

export function ProfileForm(props: ProfileFormProps) {
  const [handle, setHandle] = createSignal(props.handle)
  const [message, setMessage] = createSignal(props.message)
  const valid = () => handle().trim() !== '' && handle().trim().length <= MAX_HANDLE_LENGTH
  const save = () => {
    if (valid()) props.onSave(handle().trim(), message().slice(0, MAX_PERSONAL_MESSAGE_LENGTH))
  }

  return (
    <form
      class={styles.form}
      aria-label="Your name"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <Show when={props.first}>
        <p class={styles.intro}>
          Choose the name your friends will see. It doesn't have to be unique; friends tell you
          apart by your fingerprint.
        </p>
      </Show>
      <TextField label="Your &name:" stacked value={handle()} onInput={setHandle} />
      <TextField label="&Personal message:" stacked value={message()} onInput={setMessage} />
      <Show when={handle().length > MAX_HANDLE_LENGTH}>
        <p class={styles.error}>Names are at most {MAX_HANDLE_LENGTH} characters.</p>
      </Show>
      <div class={styles.buttons}>
        <Button label="&OK" type="submit" isDefault disabled={!valid()} class={styles.button} />
        <Show when={!props.first}>
          <Button label="Cancel" onClick={() => props.onCancel?.()} class={styles.button} />
        </Show>
      </div>
    </form>
  )
}
