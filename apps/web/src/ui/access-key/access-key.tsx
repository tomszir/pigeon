// Access keys, written the way Windows resources wrote them: "&Send" underlines S and makes
// Alt+S press it. A window finds them through `data-access-key` (see window.tsx).
import { Show } from 'solid-js'

export interface AccessKeyText {
  readonly before: string
  readonly key: string
  readonly after: string
}

/** Splits "Se&al letter" into "Se", "a", "l letter". "&&" is a literal ampersand. */
export function parseAccessKey(text: string): AccessKeyText {
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== '&') continue
    if (text[i + 1] === '&') {
      i++
      continue
    }
    const literal = (part: string) => part.replaceAll('&&', '&')
    return {
      before: literal(text.slice(0, i)),
      key: text.slice(i + 1, i + 2),
      after: literal(text.slice(i + 2)),
    }
  }
  return { before: text.replaceAll('&&', '&'), key: '', after: '' }
}

/** The plain text, for aria labels and titles. */
export function plainText(text: string): string {
  const { before, key, after } = parseAccessKey(text)
  return before + key + after
}

/** The lower-case key, or undefined when the text has none. */
export function accessKeyOf(text: string): string | undefined {
  const key = parseAccessKey(text).key
  return key === '' ? undefined : key.toLowerCase()
}

export function AccessLabel(props: { text: string }) {
  const parts = () => parseAccessKey(props.text)
  return (
    <>
      {parts().before}
      <Show when={parts().key !== ''}>
        <u>{parts().key}</u>
      </Show>
      {parts().after}
    </>
  )
}
