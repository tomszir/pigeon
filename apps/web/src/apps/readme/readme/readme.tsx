// Pigeon Reader showing Read Me.txt.
import { createSignal } from 'solid-js'
import { classes } from '../../../ui/classes/classes.ts'
import { MenuBar } from '../../../ui/menu-bar/menu-bar.tsx'
import { ScrollArea } from '../../../ui/scroll-area/scroll-area.tsx'
import styles from './readme.module.css'
import { README_TEXT } from './readme-text.ts'

export interface ReadmeProps {
  onClose: () => void
  onAbout: () => void
}

export function Readme(props: ReadmeProps) {
  const [wrap, setWrap] = createSignal(false)
  let text: HTMLPreElement | undefined

  const selectAll = () => {
    if (text === undefined) return
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  return (
    <>
      <MenuBar
        label="Pigeon Reader"
        menus={[
          { label: '&File', entries: [{ label: 'E&xit', onSelect: props.onClose }] },
          {
            label: '&Edit',
            entries: [{ label: 'Select &All', shortcut: 'Ctrl+A', onSelect: selectAll }],
          },
          {
            label: 'F&ormat',
            entries: [{ label: '&Word Wrap', checked: wrap(), onSelect: () => setWrap(!wrap()) }],
          },
          { label: '&Help', entries: [{ label: '&About Pigeon', onSelect: props.onAbout }] },
        ]}
      />
      <ScrollArea class={styles.readme} label="Read Me.txt">
        <pre ref={text} class={classes(styles.text, wrap() && styles.wrap)}>
          {README_TEXT}
        </pre>
      </ScrollArea>
    </>
  )
}
