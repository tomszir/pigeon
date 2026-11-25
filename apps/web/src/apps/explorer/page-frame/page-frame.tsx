// A sanitized page in a sandboxed frame (decision 0032). The sandbox allows same-origin, so Explorer
// can write and read the frame's document, and never scripts, so the page can't run any. Explorer
// catches link clicks in the frame and navigates itself; the frame never navigates.
//
// The page is written into the frame's blank document, not given as srcdoc: an srcdoc document is
// always in standards mode, and a written one with no doctype is in quirks mode, as pages of the
// time were. Its meta policy applies either way.
import { onCleanup, onMount } from 'solid-js'
import { frameDocument } from './frame-document.ts'
import styles from './page-frame.module.css'
import type { PageView } from './view.ts'

/** Exactly this: never `allow-scripts`, and nothing that lets the page open or move anything. */
export const FRAME_SANDBOX = 'allow-same-origin'

export interface FrameControls {
  /** Stops whatever the frame is still loading. */
  readonly stop: () => void
  /** The page's selected text. */
  readonly selection: () => string
  readonly selectAll: () => void
}

export interface PageFrameProps {
  /** The page's title, for screen readers. */
  title: string
  /** Sanitized PigeonHTML. */
  html: string
  /** Every image URL the page may load, for its policy. */
  imageUrls: readonly string[]
  /** What relative image URLs resolve against: the app's own address. */
  base: string
  /** How the page is drawn (decision 0033), and whether on a phone. Read once, when it's written. */
  view?: PageView | undefined
  phone?: boolean | undefined
  /** A link was followed: a pigeon:// address. In-page "#name" links are handled here. */
  onNavigate: (address: string) => void
  /** The pointer is over a link (its address) or left it (undefined). */
  onHover?: ((address: string | undefined) => void) | undefined
  /** Keys pressed in the page, so the window's shortcuts work there too. */
  onKeyDown?: ((event: KeyboardEvent) => void) | undefined
  onLoad?: (() => void) | undefined
  ref?: ((controls: FrameControls) => void) | undefined
}

const linkIn = (target: EventTarget | null): HTMLAnchorElement | undefined => {
  const element = target as Element | null
  const link = element?.closest?.('a[href]')
  return link === null || link === undefined ? undefined : (link as HTMLAnchorElement)
}

export function PageFrame(props: PageFrameProps) {
  let frame: HTMLIFrameElement | undefined
  let detach: (() => void) | undefined

  const follow = (doc: Document, href: string) => {
    if (!href.startsWith('#')) {
      props.onNavigate(href)
      return
    }
    const name = decodeURIComponent(href.slice(1))
    const target = doc.getElementById(name) ?? doc.getElementsByName(name)[0]
    target?.scrollIntoView()
  }

  const attach = (doc: Document) => {
    detach?.()
    const click = (event: MouseEvent) => {
      const link = linkIn(event.target)
      if (link === undefined) return
      // The frame never navigates by itself; Explorer does.
      event.preventDefault()
      if (event.button === 0) follow(doc, link.getAttribute('href') ?? '')
    }
    const auxClick = (event: MouseEvent) => {
      if (linkIn(event.target) !== undefined) event.preventDefault()
    }
    const over = (event: MouseEvent) => {
      props.onHover?.(linkIn(event.target)?.getAttribute('href') ?? undefined)
    }
    const keyDown = (event: KeyboardEvent) => props.onKeyDown?.(event)
    const submit = (event: Event) => event.preventDefault()
    doc.addEventListener('click', click)
    doc.addEventListener('auxclick', auxClick)
    doc.addEventListener('mouseover', over)
    doc.addEventListener('keydown', keyDown)
    doc.addEventListener('submit', submit)
    detach = () => {
      doc.removeEventListener('click', click)
      doc.removeEventListener('auxclick', auxClick)
      doc.removeEventListener('mouseover', over)
      doc.removeEventListener('keydown', keyDown)
      doc.removeEventListener('submit', submit)
    }
  }
  onCleanup(() => detach?.())

  // A new page is a new PageFrame, so the page is written once, as soon as the frame is in place.
  let written = false
  onMount(() => {
    const doc = frame?.contentDocument
    if (frame === undefined || doc === null || doc === undefined) return
    doc.open()
    const view =
      props.view === undefined ? undefined : { view: props.view, phone: props.phone === true }
    doc.write(frameDocument(props.html, props.imageUrls, props.base, view))
    doc.close()
    written = true
    // Writing drops a document's listeners, so they go on once the page is in.
    attach(doc)
    frame.dataset['ready'] = ''
  })

  props.ref?.({
    stop: () => frame?.contentWindow?.stop(),
    selection: () => frame?.contentWindow?.getSelection()?.toString() ?? '',
    selectAll: () => {
      const doc = frame?.contentDocument
      if (doc?.body == null) return
      doc.getSelection()?.selectAllChildren(doc.body)
    },
  })

  return (
    <iframe
      ref={frame}
      class={styles.frame}
      title={props.title}
      sandbox={FRAME_SANDBOX}
      // The blank document's own load comes before the page is written; only the page's counts.
      onLoad={() => {
        if (written) props.onLoad?.()
      }}
      onMouseLeave={() => props.onHover?.(undefined)}
    />
  )
}
