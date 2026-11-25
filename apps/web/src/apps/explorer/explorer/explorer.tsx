// Pigeon Explorer, the in-world web browser (decision 0032). For now it opens the pages that come
// with Pigeon, "On this computer", and says nobody is hosting every other address until M5.
import { PAGE_BUDGET_BYTES, type PageUrls, sanitize } from '@pigeon/pigeonhtml'
import { batch, createSignal, type JSX, Match, Show, Switch } from 'solid-js'
import { brandIcon, type Icon, tangoIcon } from '../../../ui/icons/icons.ts'
import { useLayout } from '../../../ui/layout/layout.ts'
import type { MenuEntry } from '../../../ui/menu/menu.tsx'
import { MenuBar } from '../../../ui/menu-bar/menu-bar.tsx'
import { StatusBar } from '../../../ui/status-bar/status-bar.tsx'
import { Toolbar, ToolbarButton } from '../../../ui/toolbar/toolbar.tsx'
import { AddressBar, type AddressBarControls } from '../address-bar/address-bar.tsx'
import { NotHosted, TooBig } from '../error-page/error-page.tsx'
import type { LocalPage } from '../local-pages/local-pages.ts'
import { type FrameControls, PageFrame } from '../page-frame/page-frame.tsx'
import {
  type KeptView,
  keep,
  openingView,
  type PageView,
  TEXT_SIZES,
  textSize,
  type ViewMode,
} from '../page-frame/view.ts'
import { HOME_ADDRESS, linkTarget, typedAddress } from './address.ts'
import styles from './explorer.module.css'
import {
  canGoBack,
  canGoForward,
  currentAddress,
  goBack,
  goForward,
  type History,
  startHistory,
  visit,
} from './history.ts'

export interface Favorite {
  /** "Pigeon &Home" */
  readonly label: string
  readonly address: string
}

export interface ExplorerProps {
  /** The page to open first; Home when left out. */
  start?: string | undefined
  /** A page that comes with Pigeon, or undefined for anyone else's. */
  findPage: (address: string) => LocalPage | undefined
  favorites?: readonly Favorite[] | undefined
  /** What relative image URLs resolve against; the app's own address. */
  base?: string | undefined
  /** The view kept from earlier windows (decision 0033); One Column on a phone and Desktop Layout otherwise. */
  view?: KeptView | undefined
  /** You chose another view, to keep for the next Explorer window. */
  onViewChange?: ((kept: KeptView) => void) | undefined
  copyText: (text: string) => Promise<boolean>
  onClose: () => void
  onAbout: () => void
}

/** What the page area shows for one visit. */
type Shown =
  | {
      readonly kind: 'page'
      readonly address: string
      readonly title: string
      readonly html: string
      readonly imageUrls: readonly string[]
    }
  | { readonly kind: 'not-hosted'; readonly address: string }
  | { readonly kind: 'too-big'; readonly address: string; readonly bytes: number }

/** Every page, bundled ones included, goes through the same sanitizer (decision 0032). */
function open(address: string, findPage: ExplorerProps['findPage']): Shown {
  const page = findPage(address)
  if (page === undefined) return { kind: 'not-hosted', address }
  const urls: PageUrls = {
    image: (src) => page.images?.[src],
    link: (href) => linkTarget(href, address),
  }
  const sanitized = sanitize(page.source, urls)
  if (sanitized.bytes > PAGE_BUDGET_BYTES) {
    return { kind: 'too-big', address, bytes: sanitized.bytes }
  }
  return {
    kind: 'page',
    address,
    title: sanitized.title ?? page.title,
    html: sanitized.html,
    imageUrls: Object.values(page.images ?? {}),
  }
}

/** Where the status bar says a page came from. */
const ORIGINS: Record<Shown['kind'], { readonly label: string; readonly icon: Icon }> = {
  page: { label: 'On this computer', icon: brandIcon('pigeon-16') },
  'too-big': { label: 'On this computer', icon: brandIcon('pigeon-16') },
  'not-hosted': { label: 'Pigeonweb', icon: tangoIcon('network-transmit-receive', 16) },
}

const DONE: Record<Shown['kind'], string> = {
  page: 'Done',
  'too-big': 'This page is over the size limit',
  'not-hosted': 'Could not find anyone hosting this page',
}

const DEFAULT_FAVORITES: readonly Favorite[] = [{ label: 'Pigeon &Home', address: HOME_ADDRESS }]

export function Explorer(props: ExplorerProps) {
  const [history, setHistory] = createSignal<History>(startHistory(props.start ?? HOME_ADDRESS))
  // A new object on every visit, Refresh included, so the page area draws it afresh.
  const [shown, setShown] = createSignal<Shown>(open(currentAddress(history()), props.findPage))
  const [loading, setLoading] = createSignal(shown().kind === 'page')
  const [hovered, setHovered] = createSignal<string | undefined>()
  const [statusBar, setStatusBar] = createSignal(true)
  const phone = useLayout() === 'phone'
  const [view, setView] = createSignal<PageView>(openingView(props.view, phone))
  let kept = props.view
  let frame: FrameControls | undefined
  let addressBar: AddressBarControls | undefined

  const show = (next: History) => {
    const page = open(currentAddress(next), props.findPage)
    batch(() => {
      setHistory(next)
      setHovered(undefined)
      setLoading(page.kind === 'page')
      setShown(page)
    })
  }

  const navigate = (address: string) => show(visit(history(), address))
  const back = () => {
    if (canGoBack(history())) show(goBack(history()))
  }
  const forward = () => {
    if (canGoForward(history())) show(goForward(history()))
  }
  const refresh = () => show(history())
  const home = () => navigate(HOME_ADDRESS)
  const stop = () => {
    if (!loading()) return
    frame?.stop()
    setLoading(false)
  }
  const go = (typed: string) => {
    const address = typedAddress(typed)
    if (address !== undefined) navigate(address)
  }
  const isPage = () => shown().kind === 'page'
  const keepAddressBar = (controls: AddressBarControls) => {
    addressBar = controls
  }

  /** A new view draws the page again in it. */
  const changeView = (next: PageView) => {
    kept = keep(kept, view(), next, phone)
    setView(next)
    props.onViewChange?.(kept)
    if (isPage()) refresh()
  }
  const viewAs = (mode: ViewMode) => {
    if (view().mode !== mode) changeView({ ...view(), mode })
  }
  const textBy = (step: number) => {
    const text = textSize(view().text + step)
    if (text !== view().text) changeView({ ...view(), text })
  }

  /** The keys the menus name, from the window or from inside the page. */
  const shortcut = (event: KeyboardEvent): (() => void) | undefined => {
    if (event.key === 'F5') return refresh
    if (event.key === 'Escape' && loading()) return stop
    if (event.ctrlKey && event.key === 'o') return () => addressBar?.focus()
    if (event.ctrlKey && (event.key === '+' || event.key === '=')) return () => textBy(1)
    if (event.ctrlKey && event.key === '-') return () => textBy(-1)
    if (!event.altKey) return undefined
    if (event.key === 'ArrowLeft') return back
    if (event.key === 'ArrowRight') return forward
    if (event.key === 'Home') return home
    return undefined
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const action = shortcut(event)
    if (action === undefined) return
    event.preventDefault()
    action()
  }

  const menus = () => [
    {
      label: '&File',
      entries: [
        { label: '&Open...', shortcut: 'Ctrl+O', onSelect: () => addressBar?.focus() },
        { kind: 'separator' },
        { label: '&Close', onSelect: props.onClose },
      ] satisfies MenuEntry[],
    },
    {
      label: '&Edit',
      entries: [
        {
          label: '&Copy',
          shortcut: 'Ctrl+C',
          disabled: !isPage(),
          onSelect: () => void props.copyText(frame?.selection() ?? ''),
        },
        { kind: 'separator' },
        {
          label: 'Select &All',
          shortcut: 'Ctrl+A',
          disabled: !isPage(),
          onSelect: () => frame?.selectAll(),
        },
      ] satisfies MenuEntry[],
    },
    {
      label: '&View',
      entries: [
        { label: '&Back', shortcut: 'Alt+Left', disabled: !canGoBack(history()), onSelect: back },
        {
          label: '&Forward',
          shortcut: 'Alt+Right',
          disabled: !canGoForward(history()),
          onSelect: forward,
        },
        { label: '&Home Page', shortcut: 'Alt+Home', onSelect: home },
        { kind: 'separator' },
        { label: '&Stop', shortcut: 'Esc', disabled: !loading(), onSelect: stop },
        { label: '&Refresh', shortcut: 'F5', onSelect: refresh },
        { kind: 'separator' },
        {
          label: 'One &Column',
          checked: view().mode === 'one-column',
          onSelect: () => viewAs('one-column'),
        },
        {
          label: '&Desktop Layout',
          checked: view().mode === 'desktop',
          onSelect: () => viewAs('desktop'),
        },
        { kind: 'separator' },
        {
          label: 'Text &Larger',
          shortcut: 'Ctrl++',
          disabled: view().text === TEXT_SIZES.length - 1,
          onSelect: () => textBy(1),
        },
        {
          label: 'Text S&maller',
          shortcut: 'Ctrl+-',
          disabled: view().text === 0,
          onSelect: () => textBy(-1),
        },
        { kind: 'separator' },
        {
          label: 'Status Ba&r',
          checked: statusBar(),
          onSelect: () => setStatusBar(!statusBar()),
        },
      ] satisfies MenuEntry[],
    },
    {
      label: 'F&avorites',
      entries: (props.favorites ?? DEFAULT_FAVORITES).map(
        (favorite): MenuEntry => ({
          label: favorite.label,
          onSelect: () => navigate(favorite.address),
        }),
      ),
    },
    { label: '&Help', entries: [{ label: '&About Pigeon', onSelect: props.onAbout }] },
  ]

  const statusIcon = (icon: Icon): JSX.Element => (
    <img class={styles.statusIcon} src={icon.src} alt="" width={icon.size} height={icon.size} />
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: shortcuts bubbling up from the window's controls; every one is also a menu item.
    <div class={styles.explorer} onKeyDown={onKeyDown}>
      <MenuBar label="Pigeon Explorer" menus={menus()} />
      <Show
        when={phone}
        fallback={
          <>
            <Toolbar label="Navigation" class={styles.toolbar}>
              <ToolbarButton
                inline
                icon={tangoIcon('go-previous', 22)}
                label="Back"
                disabled={!canGoBack(history())}
                onClick={back}
              />
              <ToolbarButton
                inline
                icon={tangoIcon('go-next', 22)}
                label="Forward"
                disabled={!canGoForward(history())}
                onClick={forward}
              />
              <ToolbarButton
                inline
                icon={tangoIcon('process-stop', 22)}
                label="Stop"
                disabled={!loading()}
                onClick={stop}
              />
              <ToolbarButton
                inline
                icon={tangoIcon('view-refresh', 22)}
                label="Refresh"
                onClick={refresh}
              />
              <ToolbarButton inline icon={tangoIcon('go-home', 22)} label="Home" onClick={home} />
            </Toolbar>
            <AddressBar address={shown().address} onGo={go} ref={keepAddressBar} />
          </>
        }
      >
        {/* The Pocket's one command row, as handheld browsers had: icons, and the address between them. */}
        <Toolbar label="Navigation" class={styles.commandRow}>
          <ToolbarButton
            iconOnly
            icon={tangoIcon('go-previous', 22)}
            label="Back"
            disabled={!canGoBack(history())}
            onClick={back}
          />
          <ToolbarButton
            iconOnly
            icon={tangoIcon('go-next', 22)}
            label="Forward"
            disabled={!canGoForward(history())}
            onClick={forward}
          />
          <AddressBar compact address={shown().address} onGo={go} ref={keepAddressBar} />
          <Show
            when={loading()}
            fallback={
              <ToolbarButton
                iconOnly
                icon={tangoIcon('view-refresh', 22)}
                label="Refresh"
                onClick={refresh}
              />
            }
          >
            <ToolbarButton
              iconOnly
              icon={tangoIcon('process-stop', 22)}
              label="Stop"
              onClick={stop}
            />
          </Show>
          <ToolbarButton iconOnly icon={tangoIcon('go-home', 22)} label="Home" onClick={home} />
        </Toolbar>
      </Show>
      <div class={styles.pageArea} data-explorer-page={shown().kind}>
        <Show when={shown()} keyed>
          {(page) => {
            return (
              <Switch>
                <Match when={page.kind === 'page' && page}>
                  {(found) => (
                    <PageFrame
                      title={found().title}
                      html={found().html}
                      imageUrls={found().imageUrls}
                      base={props.base ?? document.baseURI}
                      view={view()}
                      phone={phone}
                      onNavigate={navigate}
                      onHover={setHovered}
                      onKeyDown={onKeyDown}
                      onLoad={() => setLoading(false)}
                      ref={(controls) => {
                        frame = controls
                      }}
                    />
                  )}
                </Match>
                <Match when={page.kind === 'too-big' && page}>
                  {(big) => (
                    <TooBig
                      address={big().address}
                      bytes={big().bytes}
                      budget={PAGE_BUDGET_BYTES}
                      onRefresh={refresh}
                      onHome={home}
                    />
                  )}
                </Match>
                <Match when={page.kind === 'not-hosted'}>
                  <NotHosted address={page.address} onRefresh={refresh} onHome={home} />
                </Match>
              </Switch>
            )
          }}
        </Show>
      </div>
      <Show when={statusBar()}>
        <StatusBar
          fields={[
            {
              grow: true,
              content: (
                <span class={styles.status}>
                  {hovered() ?? (loading() ? `Opening ${shown().address}...` : DONE[shown().kind])}
                </span>
              ),
            },
            ...(view().mode === 'one-column' && isPage()
              ? [{ content: <span class={styles.status}>One Column</span> }]
              : []),
            {
              content: (
                <span class={styles.status}>
                  {statusIcon(ORIGINS[shown().kind].icon)}
                  {ORIGINS[shown().kind].label}
                </span>
              ),
            },
          ]}
        />
      </Show>
    </div>
  )
}
