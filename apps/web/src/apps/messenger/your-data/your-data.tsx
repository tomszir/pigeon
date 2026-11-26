// Your data in a file you keep: Export My Data seals your friends, chats and settings with a
// passphrase; Import My Data merges such a file into another of your devices. Keys never go in
// it, so a file only opens on a device of the same identity.
import { canonicalBytes } from '@pigeon/core'
import { createSignal, Match, Show, Switch } from 'solid-js'
import type { Files } from '../../../platform/files/files.ts'
import { Button } from '../../../ui/button/button.tsx'
import { classes } from '../../../ui/classes/classes.ts'
import { GroupBox } from '../../../ui/group-box/group-box.tsx'
import { useLayout } from '../../../ui/layout/layout.ts'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import type { ImportResult, Messenger } from '../service/messenger.ts'
import styles from './your-data.module.css'

/** A passphrase shorter than this is refused. */
export const MIN_PASSPHRASE_LENGTH = 8

/**
 * Seals bytes with a passphrase into one line of text, and opens it again. Both throw when the
 * passphrase can't be stretched on this device (stretching it takes tens of megabytes), which
 * says nothing about the passphrase; `open` gives undefined for one that doesn't open the text.
 */
export interface PassphraseSeal {
  seal(passphrase: string, data: Uint8Array): Promise<string>
  open(passphrase: string, text: string): Promise<Uint8Array | undefined>
}

/** What a person is told when a throw like that happens. */
export const STRETCH_FAILED =
  'Pigeon couldn’t work with that passphrase on this device. Close other tabs and try again.'

/** "Pigeon data 2026-11-25.txt" */
export const exportFileName = (at: number): string =>
  `Pigeon data ${new Date(at).toISOString().slice(0, 10)}.txt`

/** What the file says to someone who opens it in a text editor. */
export const exportFileText = (handle: string, sealed: string): string =>
  [
    `Pigeon data for ${handle}`,
    '',
    'Your friends, chats and settings, sealed with the passphrase you chose. Open Pigeon on one',
    'of your devices and choose File, Import My Data to bring them in. It holds no keys, so it',
    'only opens on a device that is already you.',
    '',
    sealed,
    '',
  ].join('\n')

export interface ExportDataProps {
  messenger: Messenger
  files: Files
  seal: PassphraseSeal
  now: () => number
  onClose: () => void
}

export function ExportData(props: ExportDataProps) {
  const phone = useLayout() === 'phone'
  const [passphrase, setPassphrase] = createSignal('')
  const [again, setAgain] = createSignal('')
  const [state, setState] = createSignal<'enter' | 'sealing' | 'saved'>('enter')
  const [failed, setFailed] = createSignal('')
  const problem = () => {
    if (passphrase().length > 0 && passphrase().length < MIN_PASSPHRASE_LENGTH)
      return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`
    if (again() !== '' && again() !== passphrase()) return 'The two passphrases differ.'
    return ''
  }
  const ready = () =>
    passphrase().length >= MIN_PASSPHRASE_LENGTH && again() === passphrase() && problem() === ''

  const save = async () => {
    if (!ready()) return
    setState('sealing')
    setFailed('')
    const bytes = canonicalBytes(props.messenger.exportData())
    let sealed: string
    try {
      sealed = await props.seal.seal(passphrase(), bytes)
    } catch {
      setFailed(STRETCH_FAILED)
      setState('enter')
      return
    }
    props.files.saveText(
      exportFileName(props.now()),
      exportFileText(props.messenger.profile().handle, sealed),
    )
    setState('saved')
  }

  return (
    <div class={classes(styles.data, phone && styles.phone)}>
      <Switch>
        <Match when={state() === 'saved'}>
          <p class={styles.text}>
            Saved. Keep the file and its passphrase apart: together they hold your friends and
            chats.
          </p>
          <div class={styles.buttons}>
            <Button label="OK" isDefault onClick={props.onClose} />
          </div>
        </Match>
        <Match when={state() !== 'saved'}>
          <GroupBox legend="Export my data">
            <form
              class={styles.column}
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <p class={styles.text}>
                Saves your friends, chats, blocked people and settings to a file, sealed with a
                passphrase. Import it on another of your devices. It holds each friend's secret too,
                so anyone with the file and the passphrase could find your friends online and see
                their names and addresses.
              </p>
              <TextField
                label="&Passphrase:"
                password
                stacked={phone}
                value={passphrase()}
                onInput={setPassphrase}
              />
              <TextField
                label="&Again:"
                password
                stacked={phone}
                value={again()}
                onInput={setAgain}
              />
              <span class={styles.error} role="alert">
                {problem() || failed()}
              </span>
              <p class={styles.muted}>
                Nobody can open it without the passphrase, not even Pigeon. Forget it and the file
                is lost.
              </p>
              <div class={styles.buttons}>
                <Button
                  label={state() === 'sealing' ? 'Sealing...' : '&Save...'}
                  type="submit"
                  isDefault
                  disabled={!ready() || state() === 'sealing'}
                />
                <Button label="Cancel" onClick={props.onClose} />
              </div>
            </form>
          </GroupBox>
        </Match>
      </Switch>
    </div>
  )
}

export interface ImportDataProps {
  messenger: Messenger
  files: Files
  seal: PassphraseSeal
  /** Imported: Pigeon starts again with what came in. */
  onImported: () => void
  onClose: () => void
}

const IMPORT_FAILURES: Readonly<Record<Exclude<ImportResult, 'imported'>, string>> = {
  'not-yours':
    'That file is someone else’s Pigeon, or yours from before this device became you. Only a device of the same Pigeon can import it.',
  unreadable: 'That file isn’t an export from Pigeon.',
}

export function ImportData(props: ImportDataProps) {
  const phone = useLayout() === 'phone'
  const [text, setText] = createSignal<string | undefined>()
  const [passphrase, setPassphrase] = createSignal('')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [done, setDone] = createSignal(false)

  const choose = async () => {
    setError('')
    const chosen = await props.files.openText('.txt,text/plain')
    if (chosen === undefined) return
    if (!chosen.includes('pigeon-sealed:')) {
      setError(IMPORT_FAILURES.unreadable)
      return
    }
    setText(chosen)
  }

  const bringIn = async () => {
    const file = text()
    if (file === undefined || passphrase() === '') return
    setBusy(true)
    setError('')
    let opened: Uint8Array | undefined
    try {
      opened = await props.seal.open(passphrase(), file)
    } catch {
      setBusy(false)
      setError(STRETCH_FAILED)
      return
    }
    if (opened === undefined) {
      setBusy(false)
      setError('The passphrase doesn’t open that file.')
      return
    }
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(opened))
    } catch {
      value = undefined
    }
    const result = await props.messenger.importData(value)
    setBusy(false)
    if (result !== 'imported') {
      setError(IMPORT_FAILURES[result])
      return
    }
    setDone(true)
    setTimeout(props.onImported, 1500)
  }

  return (
    <div class={classes(styles.data, phone && styles.phone)}>
      <Show
        when={!done()}
        fallback={<p class={styles.text}>Imported. Pigeon is starting again with it.</p>}
      >
        <GroupBox legend="Import my data">
          <form
            class={styles.column}
            onSubmit={(event) => {
              event.preventDefault()
              void bringIn()
            }}
          >
            <p class={styles.text}>
              Brings friends, chats and blocked people from a file you exported into this device.
              What's here stays; only what's missing is added.
            </p>
            <div class={styles.buttons}>
              <span class={styles.muted}>
                {text() === undefined ? 'No file chosen' : 'File chosen'}
              </span>
              <Button label="&Choose File..." onClick={() => void choose()} />
            </div>
            <TextField
              label="&Passphrase:"
              password
              stacked={phone}
              value={passphrase()}
              onInput={setPassphrase}
              disabled={text() === undefined}
            />
            <span class={styles.error} role="alert">
              {error()}
            </span>
            <div class={styles.buttons}>
              <Button
                label={busy() ? 'Opening...' : '&Import'}
                type="submit"
                isDefault
                disabled={text() === undefined || passphrase() === '' || busy()}
              />
              <Button label="Cancel" onClick={props.onClose} />
            </div>
          </form>
        </GroupBox>
      </Show>
    </div>
  )
}
