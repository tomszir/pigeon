/** @jsxImportSource @pigeon/pigeonhtml */
// Every page of in-world Help, by its pigeon://help address. Explorer serves
// these from this computer and runs each through PigeonHTML's sanitize like anyone's page.

import type { BodyAttributes, Child } from '@pigeon/pigeonhtml/jsx-runtime'
import { CHAPTERS, chapterAddress, HOW_HOME } from '../how-pigeon-works/frame.pigeon.tsx'
import { HOW_PAGES } from '../how-pigeon-works/how-pigeon-works.ts'
import { HELP_HOME, type HelpPage, helpDocument } from '../page/page.pigeon.tsx'
import { PROTOCOL_HOME, PROTOCOL_SPEC, type Spec } from '../protocol-spec/protocol-spec.pigeon.tsx'

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

const BODY: BodyAttributes = {
  bgcolor: '#ffffff',
  text: '#000000',
  link: '#0033aa',
  vlink: '#5a2a8c',
  alink: '#cc3300',
}

const Book = (props: {
  readonly title: string
  readonly address: string
  readonly about: string
  readonly children?: Child
}) => (
  <table width="100%" cellpadding="10" cellspacing="0" border="1">
    <tr>
      <td bgcolor="#eef2f8">
        <h2>
          <a href={props.address}>{props.title}</a>
        </h2>
        <span class="small">{props.about}</span>
      </td>
    </tr>
    <tr>
      <td>{props.children}</td>
    </tr>
  </table>
)

const contentsPage = (spec: Spec): HelpPage =>
  helpDocument({
    title: 'Pigeon Help',
    style: STYLE,
    bodyAttributes: BODY,
    body: (
      <>
        <table width="100%" cellpadding="12" cellspacing="0" border="0">
          <tr>
            <td bgcolor="#1f3f73">
              <font face="Arial, Helvetica, sans-serif" color="#ffffff" size="6">
                <b>Pigeon Help</b>
              </font>
              <br />
              <font color="#c9d8f0" size="2">
                Everything about Pigeon, kept on this computer
              </font>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="16" cellspacing="0" border="0">
          <tr>
            <td colspan="2">
              <p>
                Pigeon's Help came with Pigeon, so it opens even when nobody else is online. Start
                with <b>How Pigeon Works</b> for plain answers. <b>The Pigeon Protocol</b> is the
                full specification, written for people who build Pigeons.
              </p>
            </td>
          </tr>
          <tr>
            <td width="55%" valign="top">
              <Book
                title="How Pigeon Works"
                address={HOW_HOME}
                about="A guide in seven chapters, with pictures"
              >
                <ol>
                  {CHAPTERS.map((chapter) => (
                    <li>
                      <a href={chapterAddress(chapter.slug)}>{chapter.title}</a>
                      <br />
                      <span class="small">{chapter.blurb}</span>
                    </li>
                  ))}
                </ol>
              </Book>
            </td>
            <td width="45%" valign="top">
              <Book
                title="The Pigeon Protocol"
                address={PROTOCOL_HOME}
                about="The specification, made from Pigeon's own notes"
              >
                <ul>
                  {spec.contents
                    .filter((entry) => entry.depth === 0 || !entry.number.includes('.'))
                    .map((entry) => (
                      <li>
                        <a href={entry.address}>
                          {entry.number}. {entry.title}
                        </a>
                      </li>
                    ))}
                </ul>
              </Book>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="6" cellspacing="0" border="0">
          <tr>
            <td bgcolor="#dde6f3" align="center" class="small">
              Pigeon Help is on this computer. Nobody had to be online to show it to you.
            </td>
          </tr>
        </table>
      </>
    ),
  })

/** Builds Help from its two halves; `spec` is the protocol spec made from docs/. */
export const buildHelpPages = (spec: Spec): ReadonlyMap<string, HelpPage> =>
  new Map([[HELP_HOME, contentsPage(spec)], ...HOW_PAGES, ...spec.pages])

export const HELP_PAGES: ReadonlyMap<string, HelpPage> = buildHelpPages(PROTOCOL_SPEC)
