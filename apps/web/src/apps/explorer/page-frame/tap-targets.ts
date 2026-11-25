// Links a finger can hit in One Column on the Pocket.
import { TAP_TARGET } from './view.ts'

/**
 * On the Pocket in One Column, a cell or list item holding links and nothing else (a nav bar,
 * a list of chapters) is marked, so each of its links becomes a 44px row a finger can hit, as
 * Pigeon's own buttons are. Links inside running text stay as they are. The page's markup
 * isn't changed, only marked where it's drawn.
 */
export function markTapTargets(doc: Document): void {
  for (const holder of doc.querySelectorAll('td, th, li')) {
    const links = [...holder.querySelectorAll('a[href]')]
    if (links.length === 0) continue
    const linkText = links.map((link) => link.textContent ?? '').join('')
    // Separators and section numbers ("1.", "A.2") between the links don't count as text.
    const strip = (text: string) =>
      text.replace(/\b(?:[A-Z]|\d+)(?:\.\d+)*\.?(?=\s)|[\s|·•»«<>\-–—]+/g, '')
    if (strip(holder.textContent ?? '') === strip(linkText)) holder.setAttribute(TAP_TARGET, '')
  }
}
