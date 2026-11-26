import { createSignal, createUniqueId, Show } from 'solid-js'
import { AccessLabel, accessKeyOf } from '../access-key/access-key.tsx'
import { classes } from '../classes/classes.ts'
import field from '../field/field.module.css'
import styles from './text-field.module.css'

export interface TextFieldProps {
  /** Label with an optional access key, ending in a colon when shown: "&Nickname:". */
  label: string
  value: string
  onInput?: ((value: string) => void) | undefined
  /** Keep the label for screen readers but don't draw it. */
  labelHidden?: boolean | undefined
  /** Lines; more than one makes a multi-line field. */
  rows?: number | undefined
  /** The label above the field rather than beside it; multi-line fields always stack. */
  stacked?: boolean | undefined
  placeholder?: string | undefined
  disabled?: boolean | undefined
  readOnly?: boolean | undefined
  /** Dots instead of letters, for a passphrase; single-line fields only. */
  password?: boolean | undefined
  /** Enter in a multi-line field, without Shift. */
  onSubmit?: (() => void) | undefined
  /**
   * Whether text typed here and not yet sent is work to keep (see `data-unsent` below). On by
   * default; off for a field the app rewrites itself, such as Explorer's address bar.
   */
  keepsDraft?: boolean | undefined
  class?: string | undefined
}

export function TextField(props: TextFieldProps) {
  const id = createUniqueId()
  const multiline = () => (props.rows ?? 1) > 1
  // Set by the person typing, never by the app filling a field in, so a dialog opened with a
  // name already in it isn't unsent until it's changed.
  const [typed, setTyped] = createSignal(false)
  // `data-unsent` is what the page reads (app/unsaved-work.ts) to hold back an update's reload
  // while something typed here would be lost; it goes when the form empties the field.
  const unsent = () =>
    props.keepsDraft !== false && typed() && props.value !== '' ? '' : undefined
  const input = (event: { currentTarget: { value: string } }) => {
    setTyped(true)
    props.onInput?.(event.currentTarget.value)
  }

  return (
    <div
      class={classes(
        field.field,
        (multiline() || props.stacked === true) && field.stacked,
        props.class,
      )}
    >
      <label
        for={id}
        class={props.labelHidden === true ? field.visuallyHidden : undefined}
        data-access-key={accessKeyOf(props.label)}
      >
        <AccessLabel text={props.label} />
      </label>
      <Show
        when={multiline()}
        fallback={
          <input
            id={id}
            class={field.input}
            type={props.password === true ? 'password' : 'text'}
            value={props.value}
            placeholder={props.placeholder}
            disabled={props.disabled}
            readOnly={props.readOnly}
            data-unsent={unsent()}
            onInput={input}
          />
        }
      >
        <textarea
          id={id}
          class={classes(field.input, styles.multiline)}
          rows={props.rows}
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          readOnly={props.readOnly}
          data-unsent={unsent()}
          onInput={input}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && props.onSubmit !== undefined) {
              event.preventDefault()
              props.onSubmit()
            }
          }}
        />
      </Show>
    </div>
  )
}
