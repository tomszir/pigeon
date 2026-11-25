// How Explorer draws a page, never what the page says (decision 0033). Handhelds of 2003 did the
// same: Pocket Internet Explorer's One Column and Opera's Small-Screen Rendering laid any page out
// in one column, and Text Size made it bigger or smaller.

/** One Column stacks a page's tables into one column; Desktop Layout keeps them as written. */
export type ViewMode = 'one-column' | 'desktop'

/** Text Size's steps, smallest first, as zoom factors. Medium is the page as written. */
export const TEXT_SIZES = [
  { label: 'Smallest', zoom: 0.7 },
  { label: 'Smaller', zoom: 0.85 },
  { label: 'Medium', zoom: 1 },
  { label: 'Larger', zoom: 1.2 },
  { label: 'Largest', zoom: 1.45 },
] as const

/** An index into TEXT_SIZES. */
export type TextSize = 0 | 1 | 2 | 3 | 4

export const MEDIUM: TextSize = 2

export interface PageView {
  readonly mode: ViewMode
  readonly text: TextSize
}

/** Where Explorer is drawn decides the view a page opens in until you choose another. */
export const defaultView = (phone: boolean): PageView => ({
  mode: phone ? 'one-column' : 'desktop',
  text: MEDIUM,
})

/**
 * What's kept between Explorer windows: the text size, and the mode you chose for each layout.
 * Pigeon moves between the desktop and the Pocket as its window is resized, and a mode chosen
 * on one never carries to the other.
 */
export interface KeptView {
  readonly text?: TextSize | undefined
  readonly phone?: ViewMode | undefined
  readonly desktop?: ViewMode | undefined
}

/** The view a new Explorer opens in. */
export function openingView(kept: KeptView | undefined, phone: boolean): PageView {
  const fallback = defaultView(phone)
  return {
    mode: (phone ? kept?.phone : kept?.desktop) ?? fallback.mode,
    text: kept?.text ?? fallback.text,
  }
}

/** What to keep after a change from `before` to `after` on this layout. */
export function keep(
  kept: KeptView | undefined,
  before: PageView,
  after: PageView,
  phone: boolean,
): KeptView {
  const mode =
    after.mode === before.mode ? {} : phone ? { phone: after.mode } : { desktop: after.mode }
  return { ...kept, text: after.text, ...mode }
}

export const textSize = (size: number): TextSize =>
  Math.min(TEXT_SIZES.length - 1, Math.max(0, Math.round(size))) as TextSize

/** The width a page of the time was laid out for, which Desktop Layout keeps on a phone. */
export const DESKTOP_WIDTH = 800

/**
 * One Column, as Opera's Small-Screen Rendering did it: tables, cells and positioned or floated
 * boxes become plain blocks one under another, fixed widths, side margins, no-wrap and cell
 * alignment go, images
 * shrink to the screen, and the smallest font size is raised to one you can read. Colours, fonts, marquees and centering
 * stay. Preformatted text keeps its lines and scrolls sideways, so ASCII diagrams stay drawn.
 * Every rule is `!important`, since a page's own styles come later and would otherwise win.
 */
const ONE_COLUMN = [
  'table,thead,tbody,tfoot,tr,td,th,caption,col,colgroup{display:block!important;width:auto!important;height:auto!important}',
  '*{position:static!important;float:none!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;white-space:normal!important}',
  'pre,xmp,listing,plaintext,pre *{white-space:pre!important}',
  // Cells aligned left, centre and right side by side would stack into a staircase, so stacked
  // cells start at the start; a <center> or <p align> inside one still centres.
  'td,th{text-align:start!important}',
  // A side column's margin would squeeze the text once the column is stacked above it.
  'div,table,center{margin-left:0!important;margin-right:0!important}',
  'body{overflow-wrap:break-word!important;margin:8px!important}',
  'img{height:auto!important}',
  'pre,xmp,listing{overflow-x:auto!important;overflow-wrap:normal!important}',
  'font[size="1"]{font-size:small!important}',
].join('\n')

/** Where marked, a link fills a finger's height (tap-targets.ts). */
export const TAP_TARGET = 'data-pg-tap'
const TAP_TARGETS = `[${TAP_TARGET}] a[href]{display:block!important;min-height:44px!important;padding:12px 0!important}`

/** Explorer's stylesheet for a view, written after the base one. */
export function viewStylesheet(view: PageView, phone: boolean): string {
  const rules: string[] = []
  if (view.mode === 'one-column') rules.push(ONE_COLUMN)
  if (view.mode === 'one-column' && phone) rules.push(TAP_TARGETS)
  else if (phone) rules.push(`html{min-width:${DESKTOP_WIDTH}px}`)
  const { zoom } = TEXT_SIZES[view.text]
  if (zoom !== 1) rules.push(`html{zoom:${zoom}}`)
  return rules.join('\n')
}
