// PigeonHTML's allowlists (docs/pigeonhtml.md): HTML 4.01 Transitional's elements and
// presentational attributes, and CSS 2.1's properties. Anything not named here is dropped.

// The tables are literal (`as const`); the Maps and Sets below are built from them for the
// sanitizer.

/** Attributes every kept element may carry. `style` goes through the CSS allowlist. */
export const GLOBAL_ATTRIBUTE_TABLE = ['id', 'class', 'title', 'lang', 'dir', 'style'] as const

export const GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set(GLOBAL_ATTRIBUTE_TABLE)

/**
 * The elements kept, each with the attributes it may carry beyond the global ones. `html`,
 * `head`, `body`, `title` and `style` are written by the sanitizer itself and aren't here.
 * Framesets and forms are deferred (docs/pigeonhtml.md). `img` has no `name`: a named image
 * would shadow properties of the frame's `document`, which Explorer reads. The cells' alignment
 * attributes (`align`, `valign`, `char`, `charoff`) are written out each time: the table has to be
 * one literal, which a spread of a shared list isn't, for the types derived from it.
 */
export const ELEMENT_TABLE = {
  a: ['href', 'name'],
  abbr: [],
  acronym: [],
  address: [],
  area: ['href', 'alt', 'shape', 'coords', 'nohref'],
  b: [],
  basefont: ['color', 'face', 'size'],
  bdo: [],
  big: [],
  blink: [],
  blockquote: [],
  br: ['clear'],
  caption: ['align'],
  center: [],
  cite: [],
  code: [],
  col: ['span', 'width', 'align', 'valign', 'char', 'charoff'],
  colgroup: ['span', 'width', 'align', 'valign', 'char', 'charoff'],
  dd: [],
  del: ['datetime'],
  dfn: [],
  dir: ['compact'],
  div: ['align'],
  dl: ['compact'],
  dt: [],
  em: [],
  fieldset: [],
  font: ['color', 'face', 'size'],
  h1: ['align'],
  h2: ['align'],
  h3: ['align'],
  h4: ['align'],
  h5: ['align'],
  h6: ['align'],
  hr: ['align', 'noshade', 'size', 'width', 'color'],
  i: [],
  img: ['src', 'alt', 'width', 'height', 'border', 'align', 'hspace', 'vspace', 'usemap', 'ismap'],
  ins: ['datetime'],
  kbd: [],
  legend: ['align'],
  li: ['type', 'value'],
  map: ['name'],
  marquee: [
    'behavior',
    'direction',
    'scrollamount',
    'scrolldelay',
    'loop',
    'bgcolor',
    'width',
    'height',
    'hspace',
    'vspace',
  ],
  menu: ['compact'],
  nobr: [],
  ol: ['type', 'compact', 'start'],
  p: ['align'],
  pre: ['width'],
  q: [],
  s: [],
  samp: [],
  small: [],
  span: [],
  strike: [],
  strong: [],
  sub: [],
  sup: [],
  table: [
    'width',
    'height',
    'border',
    'cellpadding',
    'cellspacing',
    'bgcolor',
    'background',
    'bordercolor',
    'align',
    'frame',
    'rules',
    'summary',
  ],
  tbody: ['align', 'valign', 'char', 'charoff'],
  td: [
    'abbr',
    'axis',
    'headers',
    'scope',
    'rowspan',
    'colspan',
    'nowrap',
    'bgcolor',
    'background',
    'bordercolor',
    'width',
    'height',
    'align',
    'valign',
    'char',
    'charoff',
  ],
  tfoot: ['align', 'valign', 'char', 'charoff'],
  th: [
    'abbr',
    'axis',
    'headers',
    'scope',
    'rowspan',
    'colspan',
    'nowrap',
    'bgcolor',
    'background',
    'bordercolor',
    'width',
    'height',
    'align',
    'valign',
    'char',
    'charoff',
  ],
  thead: ['align', 'valign', 'char', 'charoff'],
  tr: ['bgcolor', 'background', 'height', 'align', 'valign', 'char', 'charoff'],
  tt: [],
  u: [],
  ul: ['type', 'compact'],
  var: [],
  wbr: [],
} as const

/** The kept elements by name, each with the attributes it may carry beyond the global ones. */
export const ELEMENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(ELEMENT_TABLE).map(([name, attributes]) => [name, new Set<string>(attributes)]),
)

/** `body`'s attributes, the era's margin ones included. */
export const BODY_ATTRIBUTE_TABLE = [
  'bgcolor',
  'text',
  'link',
  'vlink',
  'alink',
  'background',
  'marginwidth',
  'marginheight',
  'leftmargin',
  'topmargin',
] as const

export const BODY_ATTRIBUTES: ReadonlySet<string> = new Set(BODY_ATTRIBUTE_TABLE)

/** Elements without content or an end tag. */
export const VOID_ELEMENT_TABLE = ['area', 'basefont', 'br', 'col', 'hr', 'img', 'wbr'] as const

export const VOID_ELEMENTS: ReadonlySet<string> = new Set(VOID_ELEMENT_TABLE)

/**
 * Elements dropped with everything inside them, not just their tags: what they hold isn't
 * page text (scripts, raw text, embedded documents, form controls) or reads differently in
 * the sandbox than in the parser. Any other element off the list loses its tags and keeps
 * its content. Foreign content (svg, math) is always dropped whole.
 */
export const DROPPED_WITH_CONTENT: ReadonlySet<string> = new Set([
  'applet',
  'audio',
  'base',
  'canvas',
  'datalist',
  'embed',
  'frame',
  'frameset',
  'iframe',
  'input',
  'isindex',
  'keygen',
  'link',
  'listing',
  'math',
  'meta',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'optgroup',
  'option',
  'param',
  'picture',
  'plaintext',
  'portal',
  'script',
  'select',
  'source',
  'svg',
  'template',
  'textarea',
  'track',
  'video',
  'xmp',
])

/** Attributes holding an image the page loads, through `urls.image`. */
export const IMAGE_ATTRIBUTES: ReadonlySet<string> = new Set(['src', 'background'])

/** Attributes holding a link, through `urls.link`. */
export const LINK_ATTRIBUTES: ReadonlySet<string> = new Set(['href'])

/** CSS 2.1's visual properties. The aural ones and every later or vendor property are dropped. */
export const CSS_PROPERTIES: ReadonlySet<string> = new Set([
  'background',
  'background-attachment',
  'background-color',
  'background-image',
  'background-position',
  'background-repeat',
  'border',
  'border-collapse',
  'border-color',
  'border-spacing',
  'border-style',
  'border-width',
  ...['top', 'right', 'bottom', 'left'].flatMap((side) => [
    `border-${side}`,
    `border-${side}-color`,
    `border-${side}-style`,
    `border-${side}-width`,
    `margin-${side}`,
    `padding-${side}`,
  ]),
  'bottom',
  'caption-side',
  'clear',
  'clip',
  'color',
  'content',
  'counter-increment',
  'counter-reset',
  'cursor',
  'direction',
  'display',
  'empty-cells',
  'float',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'height',
  'left',
  'letter-spacing',
  'line-height',
  'list-style',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'margin',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'orphans',
  'outline',
  'outline-color',
  'outline-style',
  'outline-width',
  'overflow',
  'padding',
  'page-break-after',
  'page-break-before',
  'page-break-inside',
  'position',
  'quotes',
  'right',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'top',
  'unicode-bidi',
  'vertical-align',
  'visibility',
  'white-space',
  'widows',
  'width',
  'word-spacing',
  'z-index',
])

/** Properties whose value may hold an image's `url()`, through `urls.image`. */
export const CSS_URL_PROPERTIES: ReadonlySet<string> = new Set([
  'background',
  'background-image',
  'list-style',
  'list-style-image',
  'content',
])

/** The highest `z-index` a page may give, either way, so it can't outrank whatever draws over it. */
export const MAX_Z_INDEX = 100

/** Values limited to CSS 2.1's keywords, so `display: flex` or `position: sticky` is dropped. */
export const CSS_KEYWORDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    'display',
    new Set([
      'inline',
      'block',
      'list-item',
      'run-in',
      'inline-block',
      'table',
      'inline-table',
      'table-row-group',
      'table-header-group',
      'table-footer-group',
      'table-row',
      'table-column-group',
      'table-column',
      'table-cell',
      'table-caption',
      'none',
      'inherit',
    ]),
  ],
  // No `fixed`: a page could pin a layer over the whole frame and catch every click.
  ['position', new Set(['static', 'relative', 'absolute', 'inherit'])],
])

/** Functions a value may call. `url` is checked on its own. */
export const CSS_FUNCTIONS: ReadonlySet<string> = new Set([
  'rgb',
  'rect',
  'counter',
  'counters',
  'attr',
  'url',
])

/** CSS 2.1's units. */
export const CSS_UNITS: ReadonlySet<string> = new Set([
  'em',
  'ex',
  'px',
  'in',
  'cm',
  'mm',
  'pt',
  'pc',
  'deg',
  'grad',
  'rad',
  'ms',
  's',
  'hz',
  'khz',
])

/** CSS 2.1's pseudo-classes and pseudo-elements, written with one colon as in 2003. */
export const CSS_PSEUDOS: ReadonlySet<string> = new Set([
  'link',
  'visited',
  'hover',
  'active',
  'focus',
  'first-child',
  'first-line',
  'first-letter',
  'before',
  'after',
])

/** The media a `@media` block may name. */
export const CSS_MEDIA: ReadonlySet<string> = new Set(['all', 'screen', 'print'])
