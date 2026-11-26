// @vitest-environment-options {"settings":{"enableIframePageLoading":true}}
// Iframe loading on, so the page frame gets a blank document to write the page into, as browsers do.
import type { PageUrls, Sanitized } from '@pigeon/pigeonhtml'
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Window } from '../../../ui/window/window.tsx'
import { type LocalPage, localPageFinder } from '../local-pages/local-pages.ts'
import type { KeptView } from '../page-frame/view.ts'
import { Explorer } from './explorer.tsx'

// Explorer is written against PigeonHTML's API, not whichever sanitizer is in place: this one
// rewrites href and src through the PageUrls it's given and drops what they refuse.
const sanitizeCalls = vi.hoisted(() => [] as { source: string; urls: PageUrls }[])
vi.mock('@pigeon/pigeonhtml', async (original) => ({
  ...(await original<typeof import('@pigeon/pigeonhtml')>()),
  sanitize: (source: string, urls: PageUrls): Sanitized => {
    sanitizeCalls.push({ source, urls })
    const html = source.replace(/ (href|src)="([^"]*)"/g, (_, name: string, value: string) => {
      const to = name === 'href' ? urls.link(value) : urls.image(value)
      return to === undefined ? '' : ` ${name}="${to}"`
    })
    return {
      html,
      title: /<title>(.*?)<\/title>/.exec(source)?.[1],
      bytes: new TextEncoder().encode(source).length,
      removed: [],
    }
  },
}))

const PAGES = new Map<string, LocalPage>([
  [
    'pigeon://home',
    {
      title: 'Home',
      source:
        '<title>Pigeon Home</title><a href="about">About</a> <a href="https://example.com">Out</a> <a href="pigeon://mika">Mika</a> <img src="logo.png">',
      images: { 'logo.png': '/assets/logo.png' },
    },
  ],
  ['pigeon://home/about', { title: 'About', source: '<p>About this computer</p>' }],
  [
    'pigeon://map',
    {
      title: 'Map',
      source:
        '<map name="m"><area href="pigeon://home/about" shape="rect" coords="0,0,8,8" alt="About"><area href="#end" shape="rect" coords="8,0,16,8" alt="End"><area href="#%E0" shape="rect" coords="16,0,24,8" alt="Broken"></map><img src="logo.png" usemap="#m"><p id="end">End</p><p id="%E0">Broken</p>',
      images: { 'logo.png': '/assets/logo.png' },
    },
  ],
  ['pigeon://big', { title: 'Big', source: `<p>${'x'.repeat(101 * 1024)}</p>` }],
])

function renderExplorer(start?: string, onViewChange?: (kept: KeptView) => void) {
  const copyText = vi.fn(async () => true)
  render(() => (
    <Window title="Pigeon Explorer" active bounds={{ x: 0, y: 0, width: 720, height: 560 }}>
      <Explorer
        start={start}
        findPage={localPageFinder(PAGES)}
        base="https://pigeon.test/"
        copyText={copyText}
        onViewChange={onViewChange}
        onClose={() => {}}
        onAbout={() => {}}
      />
    </Window>
  ))
  return { copyText }
}

const frame = () => document.querySelector('iframe') as HTMLIFrameElement | null

/** The frame's document, once Explorer is listening to it. */
async function loadedFrame(): Promise<Document> {
  let doc: Document | undefined
  await waitFor(() => {
    const loaded = document.querySelector<HTMLIFrameElement>('iframe[data-ready]')
    doc = loaded?.contentDocument ?? undefined
    if (doc === undefined) throw new Error('frame not loaded')
  })
  if (doc === undefined) throw new Error('frame not loaded')
  return doc
}

/** One of the page's image map areas, by its alt text. */
async function area(alt: string): Promise<HTMLAreaElement> {
  const doc = await loadedFrame()
  const found = doc.querySelector<HTMLAreaElement>(`area[alt="${alt}"]`)
  if (found === null) throw new Error(`no area ${alt}`)
  return found
}

async function clickLink(text: string) {
  const doc = await loadedFrame()
  const link = [...doc.querySelectorAll('a')].find((a) => a.textContent === text)
  if (link === undefined) throw new Error(`no link ${text}`)
  link.click()
}

const address = () => (screen.getByLabelText('Address') as HTMLInputElement).value
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('Explorer', () => {
  it('opens at the start page, from this computer, through the sanitizer', async () => {
    sanitizeCalls.length = 0
    renderExplorer()
    expect(address()).toBe('pigeon://home')
    expect(sanitizeCalls[0]?.source).toContain('<title>Pigeon Home</title>')
    expect((await loadedFrame()).body.textContent).toContain('About')
    expect(frame()?.title).toBe('Pigeon Home')
    expect(screen.getByRole('status').textContent).toContain('On this computer')
  })

  it('renders in a sandbox that never allows scripts, under a strict policy', async () => {
    renderExplorer()
    const sandbox = frame()?.getAttribute('sandbox')
    expect(sandbox).toBe('allow-same-origin')
    expect(sandbox).not.toContain('allow-scripts')
    const doc = await loadedFrame()
    const policy = doc.querySelector('meta[http-equiv]')
    expect(policy?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(policy?.getAttribute('content')).toMatch(
      /^default-src 'none'; img-src https:\/\/pigeon\.test\/assets\/logo\.png; style-src 'unsafe-inline'; font-src [^;]+$/,
    )
  })

  it('gives the page its own images and pigeon:// links only', async () => {
    sanitizeCalls.length = 0
    renderExplorer()
    const urls = sanitizeCalls[0]?.urls
    expect(urls?.image('logo.png')).toBe('/assets/logo.png')
    expect(urls?.image('elsewhere.png')).toBeUndefined()
    expect(urls?.link('about')).toBe('pigeon://home/about')
    expect(urls?.link('https://example.com')).toBeUndefined()
    expect(urls?.link('javascript:alert(1)')).toBeUndefined()
    const doc = await loadedFrame()
    const hrefs = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['pigeon://home/about', 'pigeon://mika'])
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('/assets/logo.png')
  })

  it('follows a link from the page and walks history with Back and Forward', async () => {
    renderExplorer()
    expect(button('Back').disabled).toBe(true)
    await clickLink('About')
    await waitFor(() => expect(address()).toBe('pigeon://home/about'))
    expect((await loadedFrame()).body.textContent).toContain('About this computer')
    expect(button('Back').disabled).toBe(false)
    expect(button('Forward').disabled).toBe(true)

    fireEvent.click(button('Back'))
    expect(address()).toBe('pigeon://home')
    expect(button('Forward').disabled).toBe(false)

    fireEvent.click(button('Forward'))
    expect(address()).toBe('pigeon://home/about')

    fireEvent.click(button('Home'))
    expect(address()).toBe('pigeon://home')
    expect(button('Forward').disabled).toBe(true)
  })

  it("follows an image map's area as it does a link, and shows where it goes", async () => {
    renderExplorer('pigeon://map')
    const about = await area('About')
    about.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(screen.getByRole('status').textContent).toContain('pigeon://home/about')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    about.dispatchEvent(click)
    // Cancelled, so the frame doesn't try to go there by itself.
    expect(click.defaultPrevented).toBe(true)
    await waitFor(() => expect(address()).toBe('pigeon://home/about'))
  })

  it('scrolls to an in-page "#name" from an area, even one with a broken escape', async () => {
    renderExplorer('pigeon://map')
    const doc = await loadedFrame()
    const scrolled: string[] = []
    for (const target of doc.querySelectorAll('p'))
      target.scrollIntoView = () => scrolled.push(target.id)
    ;(await area('End')).click()
    ;(await area('Broken')).click()
    expect(scrolled).toEqual(['end', '%E0'])
    expect(address()).toBe('pigeon://map')
  })

  it('forgets the pages ahead when a new one is opened after going back', async () => {
    renderExplorer()
    await clickLink('About')
    await waitFor(() => expect(address()).toBe('pigeon://home/about'))
    fireEvent.click(button('Back'))
    await clickLink('Mika')
    await waitFor(() => expect(address()).toBe('pigeon://mika'))
    expect(button('Forward').disabled).toBe(true)
    fireEvent.click(button('Back'))
    expect(address()).toBe('pigeon://home')
  })

  it('opens what is typed in the address bar', () => {
    renderExplorer()
    const field = screen.getByLabelText('Address')
    fireEvent.input(field, { target: { value: 'home/about' } })
    fireEvent.click(button('Go'))
    expect(address()).toBe('pigeon://home/about')
  })

  it("says nobody is hosting an address that doesn't come with Pigeon", () => {
    renderExplorer('pigeon://mika')
    expect(frame()).toBeNull()
    expect(screen.getByRole('heading').textContent).toBe("This page isn't being hosted right now")
    expect(screen.getByText('pigeon://mika')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Pigeonweb')
    expect(screen.getByRole('status').textContent).not.toContain('On this computer')
    fireEvent.click(button('Home Page'))
    expect(address()).toBe('pigeon://home')
  })

  it('shows any other scheme as not hosted too', () => {
    renderExplorer()
    fireEvent.input(screen.getByLabelText('Address'), { target: { value: 'https://example.com' } })
    fireEvent.click(button('Go'))
    expect(screen.getByRole('heading').textContent).toBe("This page isn't being hosted right now")
  })

  it('refuses a page over the dial-up budget', () => {
    renderExplorer('pigeon://big')
    expect(frame()).toBeNull()
    expect(screen.getByRole('heading').textContent).toBe('This page is too big to open')
    expect(screen.getByText(/PGN_TOO_BIG: 102 KB of 100 KB/)).toBeTruthy()
  })

  it('Refresh draws the page afresh', async () => {
    renderExplorer()
    const first = frame()
    fireEvent.click(button('Refresh'))
    expect(frame()).not.toBe(first)
    expect(address()).toBe('pigeon://home')
    await loadedFrame()
  })

  it('goes back with Alt+Left, even from inside the page', async () => {
    renderExplorer()
    await clickLink('About')
    await waitFor(() => expect(address()).toBe('pigeon://home/about'))
    const doc = await loadedFrame()
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true }))
    expect(address()).toBe('pigeon://home')
  })

  it('switches between One Column and Desktop Layout from View, drawing the page again', async () => {
    const onViewChange = vi.fn()
    renderExplorer(undefined, onViewChange)
    const style = (doc: Document) =>
      [...doc.querySelectorAll('style')].map((s) => s.textContent).join('')
    expect(style(await loadedFrame())).not.toContain('display:block!important')
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /One Column/ }))
    expect(onViewChange).toHaveBeenLastCalledWith({ text: 2, desktop: 'one-column' })
    await waitFor(async () =>
      expect(style(await loadedFrame())).toContain('display:block!important'),
    )
    expect(screen.getByRole('status').textContent).toContain('One Column')
  })

  it('makes text larger and smaller with Ctrl+Plus and Ctrl+Minus', async () => {
    const onViewChange = vi.fn()
    renderExplorer(undefined, onViewChange)
    await loadedFrame()
    const explorer = document.querySelector('[data-explorer-page]') as HTMLElement
    fireEvent.keyDown(explorer, { key: '+', ctrlKey: true })
    expect(onViewChange).toHaveBeenLastCalledWith({ text: 3 })
    fireEvent.keyDown(explorer, { key: '-', ctrlKey: true })
    fireEvent.keyDown(explorer, { key: '-', ctrlKey: true })
    expect(onViewChange).toHaveBeenLastCalledWith({ text: 1 })
  })
})
