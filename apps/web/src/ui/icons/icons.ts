// Typed URLs for the vendored bitmaps in src/icons/ (vendor/VENDOR.md). A name missing here is a
// type error; a name here missing on disk fails icons.test.ts.

const urls = import.meta.glob<string>('../../icons/{tango,brand,xp}/*.{png,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
})

export const TANGO_ICONS = [
  'contact-new',
  'dialog-error',
  'dialog-information',
  'dialog-warning',
  'face-smile',
  'folder',
  'go-home',
  'go-jump',
  'go-next',
  'go-previous',
  'help-browser',
  'image-x-generic',
  'internet-mail',
  'internet-web-browser',
  'mail-attachment',
  'network-server',
  'network-transmit-receive',
  'network-workgroup',
  'preferences-system',
  'process-stop',
  'system-log-out',
  'system-shutdown',
  'text-x-generic',
  'user-trash',
  'view-refresh',
] as const

export const BRAND_ICONS = [
  'bell-16',
  'buzz-22',
  'messenger-16',
  'messenger-22',
  'messenger-32',
  'messenger-48',
  'paper-plane-24',
  'pigeon-16',
  'pigeon-24',
  'pigeon-32',
  'pigeon-48',
  'pigeon-128',
  'presence-16',
  'presence-16-away',
  'presence-16-offline',
  'presence-16-online',
] as const

export type TangoIcon = (typeof TANGO_ICONS)[number]
export type BrandIcon = (typeof BRAND_ICONS)[number]
export type IconSize = 16 | 22 | 32

function url(path: string): string {
  const found = urls[`../../icons/${path}`]
  if (found === undefined) throw new Error(`icon ${path} is not vendored`)
  return found
}

export const tango = (name: TangoIcon, size: IconSize): string => url(`tango/${name}-${size}.png`)

export const brand = (name: BrandIcon): string => url(`brand/${name}.png`)

/** Any icon a component can be handed: a URL plus its drawn size. */
export interface Icon {
  readonly src: string
  readonly size: number
}

export const tangoIcon = (name: TangoIcon, size: IconSize): Icon => ({
  src: tango(name, size),
  size,
})

export const brandIcon = (name: BrandIcon): Icon => {
  const size = Number(/-(\d+)/.exec(name)?.[1] ?? 16)
  return { src: brand(name), size }
}
