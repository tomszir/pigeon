// Every page of in-world Help, by its pigeon://help address. Explorer serves
// these from this computer and runs each through PigeonHTML's sanitize like anyone's page.

import { CHAPTERS, chapterAddress, HOW_HOME } from '../how-pigeon-works/frame.ts'
import { HOW_PAGES } from '../how-pigeon-works/how-pigeon-works.ts'
import { escapeHtml } from '../markdown/markdown.ts'
import { HELP_HOME, type HelpPage, helpDocument } from '../page/page.ts'
import { PROTOCOL_HOME, PROTOCOL_SPEC, type Spec } from '../protocol-spec/protocol-spec.ts'

export { HELP_HOME, type HelpPage }

const STYLE = `
body { margin: 0; background-color: #ffffff; color: #000000; }
body, td, th, p, li { font-family: Verdana, Tahoma, Arial, sans-serif; font-size: 12px; }
p { margin: 0 0 10px 0; line-height: 1.45; }
li { margin-bottom: 5px; }
h2 { font-family: Arial, Helvetica, sans-serif; font-size: 16px; color: #1f3f73; margin: 0 0 6px 0; }
a:link { color: #0033aa; }
a:visited { color: #5a2a8c; }
a:hover { color: #cc3300; }
.small { font-size: 11px; color: #555555; }
`

const link = (address: string, text: string) =>
  `<a href="${escapeHtml(address)}">${escapeHtml(text)}</a>`

const book = (title: string, address: string, about: string, items: string) =>
  [
    '<table width="100%" cellpadding="10" cellspacing="0" border="1">',
    `<tr><td bgcolor="#eef2f8"><h2>${link(address, title)}</h2><span class="small">${about}</span></td></tr>`,
    `<tr><td>${items}</td></tr>`,
    '</table>',
  ].join('\n')

const contentsPage = (spec: Spec): HelpPage => {
  const chapters = CHAPTERS.map(
    (chapter) =>
      `<li>${link(chapterAddress(chapter.slug), chapter.title)}<br><span class="small">${escapeHtml(chapter.blurb)}</span></li>`,
  ).join('\n')
  const sections = spec.contents
    .filter((entry) => entry.depth === 0 || !entry.number.includes('.'))
    .map((entry) => `<li>${link(entry.address, `${entry.number}. ${entry.title}`)}</li>`)
    .join('\n')
  return helpDocument({
    title: 'Pigeon Help',
    style: STYLE,
    bodyAttributes:
      'bgcolor="#ffffff" text="#000000" link="#0033aa" vlink="#5a2a8c" alink="#cc3300"',
    body: `
<table width="100%" cellpadding="12" cellspacing="0" border="0">
<tr><td bgcolor="#1f3f73"><font face="Arial, Helvetica, sans-serif" color="#ffffff" size="6"><b>Pigeon Help</b></font><br>
<font color="#c9d8f0" size="2">Everything about Pigeon, kept on this computer</font></td></tr>
</table>
<table width="100%" cellpadding="16" cellspacing="0" border="0">
<tr><td colspan="2">
<p>Pigeon's Help came with Pigeon, so it opens even when nobody else is online. Start with <b>How Pigeon Works</b> for plain answers. <b>The Pigeon Protocol</b> is the full specification, written for people who build Pigeons.</p>
</td></tr>
<tr>
<td width="55%" valign="top">
${book(
  'How Pigeon Works',
  HOW_HOME,
  'A guide in seven chapters, with pictures',
  `<ol>\n${chapters}\n</ol>`,
)}
</td>
<td width="45%" valign="top">
${book(
  'The Pigeon Protocol',
  PROTOCOL_HOME,
  'The specification, made from Pigeon&#39;s own notes',
  `<ul>\n${sections}\n</ul>`,
)}
</td>
</tr>
</table>
<table width="100%" cellpadding="6" cellspacing="0" border="0"><tr><td bgcolor="#dde6f3" align="center" class="small">
Pigeon Help is on this computer. Nobody had to be online to show it to you.
</td></tr></table>
`,
  })
}

/** Builds Help from its two halves; `spec` is the protocol spec made from docs/. */
export const buildHelpPages = (spec: Spec): ReadonlyMap<string, HelpPage> =>
  new Map([[HELP_HOME, contentsPage(spec)], ...HOW_PAGES, ...spec.pages])

export const HELP_PAGES: ReadonlyMap<string, HelpPage> = buildHelpPages(PROTOCOL_SPEC)
