// The address bar: type a pigeon:// address and press Enter or Go.
import { createEffect, createSignal, on, Show } from 'solid-js'
import { classes } from '../../../ui/classes/classes.ts'
import { tangoIcon } from '../../../ui/icons/icons.ts'
import { TextField } from '../../../ui/text-field/text-field.tsx'
import { ToolbarButton } from '../../../ui/toolbar/toolbar.tsx'
import styles from './address-bar.module.css'

export interface AddressBarControls {
  /** Puts the cursor in the field with the address selected, for File, Open. */
  readonly focus: () => void
}

export interface AddressBarProps {
  /** The address showing; what's typed goes back to it whenever it changes. */
  address: string
  onGo: (typed: string) => void
  /** Only the field, for the Pocket's one command row: its label hidden, and Enter does Go. */
  compact?: boolean | undefined
  ref?: ((controls: AddressBarControls) => void) | undefined
}

export function AddressBar(props: AddressBarProps) {
  const [typed, setTyped] = createSignal(props.address)
  createEffect(
    on(
      () => props.address,
      (address) => setTyped(address),
      { defer: true },
    ),
  )
  let form: HTMLFormElement | undefined
  const input = () => form?.querySelector('input') ?? undefined

  props.ref?.({
    focus: () => {
      input()?.focus()
      input()?.select()
    },
  })

  const go = () => props.onGo(typed())

  return (
    <form
      ref={form}
      class={classes(styles.addressBar, props.compact === true && styles.compact)}
      onSubmit={(event) => {
        event.preventDefault()
        go()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || typed() === props.address) return
        event.stopPropagation()
        setTyped(props.address)
      }}
    >
      <TextField
        class={styles.field}
        label="A&ddress"
        labelHidden={props.compact}
        value={typed()}
        onInput={setTyped}
        keepsDraft={false}
      />
      <Show when={props.compact !== true}>
        <ToolbarButton inline icon={tangoIcon('go-jump', 22)} label="Go" onClick={go} />
      </Show>
    </form>
  )
}
