// Renders assets/brand/share-card.html into public/share-card.png, the picture chat apps and
// search engines show beside a link to Pigeon. Run it with `mise run share-card` after changing
// the card. The card's files are served from the repository's root under a made-up origin,
// because a page opened from disk may not load fonts.
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = new URL('../../', import.meta.url)
const origin = 'http://share-card.invalid'
const out = fileURLToPath(new URL('public/share-card.png', import.meta.url))

const types: Record<string, string> = {
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf',
}

const browser = await chromium.launch()
try {
  // 1200×630, the size link previews ask for; the card scales its 600×315 layout 2× itself.
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1)
    const body = await readFile(new URL(path, root))
    await route.fulfill({ body, contentType: types[extname(path)] ?? 'application/octet-stream' })
  })
  await page.goto(`${origin}/assets/brand/share-card.html`)
  await page.evaluate('document.fonts.ready')
  await page.screenshot({ path: out })
  console.log(`wrote ${out}`)
} finally {
  await browser.close()
}
