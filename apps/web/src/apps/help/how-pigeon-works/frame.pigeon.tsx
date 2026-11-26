/** @jsxImportSource @pigeon/pigeonhtml */
// The look every "How Pigeon Works" page shares: a banner, a trail, a sidebar of chapters and
// numbered steps, like an encyclopedic how-it-works site of 2003. Content and order live in
// CHAPTERS; each chapter's body is in a file of its own.

import type { BodyAttributes, Child } from '@pigeon/pigeonhtml/jsx-runtime'
import { HELP_HOME, type HelpPage, helpDocument } from '../page/page.pigeon.tsx'

export const HOW_HOME = `${HELP_HOME}how/`

export interface Chapter {
  /** The address after HOW_HOME; '' is the guide's first page. */
  readonly slug: string
  readonly title: string
  /** One line for the contents. */
  readonly blurb: string
}

export const CHAPTERS: readonly Chapter[] = [
  {
    slug: '',
    title: 'Pigeon in One Picture',
    blurb: 'Who you are, how two browsers find each other, and where your chats live.',
  },
  {
    slug: 'adding-a-friend',
    title: 'Adding a Friend',
    blurb: 'Invite codes, links and QR codes, and the fingerprint that proves who answered.',
  },
  {
    slug: 'private-rooms',
    title: 'Your Private Rooms',
    blurb: 'The room only you and a friend can find, and going through the relay.',
  },
  {
    slug: 'your-devices',
    title: 'Your Devices',
    blurb: 'One Pigeon on your phone and your computer: linking and removing devices.',
  },
  {
    slug: 'recovery-key',
    title: 'Your Recovery Key',
    blurb: 'Making one, keeping it, and coming back with every device lost.',
  },
  {
    slug: 'saving-your-data',
    title: 'Saving Your Data',
    blurb: 'Your friends and chats in a sealed file, and a chat as plain text.',
  },
  {
    slug: 'coming-soon',
    title: 'Coming Soon',
    blurb: "Letters, files and Explorer pages: what's planned and not built yet.",
  },
]

export const chapterAddress = (slug: string) => `${HOW_HOME}${slug}`

const STYLE = `
body { margin: 0; background-color: #ffffff; color: #000000; }
body, td, th, p, li { font-family: Verdana, Tahoma, Arial, sans-serif; font-size: 12px; }
pre, code, tt { font-family: "Courier New", Courier, monospace; font-size: 12px; }
p { margin: 0 0 10px 0; line-height: 1.45; }
ul, ol { margin-top: 0; margin-bottom: 10px; }
li { margin-bottom: 4px; line-height: 1.4; }
h1 { font-family: Arial, Helvetica, sans-serif; font-size: 22px; color: #1f3f73; margin: 0 0 6px 0; }
h2 { font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #1f3f73; margin: 22px 0 8px 0; border-bottom: 1px solid #b8c7de; }
pre { margin: 0; line-height: 1.2; }
a:link { color: #0033aa; }
a:visited { color: #5a2a8c; }
a:hover { color: #cc3300; }
.lead { font-size: 13px; color: #333333; }
.trail { font-size: 11px; }
.side { font-size: 11px; }
.side td { font-size: 11px; }
.caption { font-size: 11px; color: #333333; }
.small { font-size: 11px; color: #555555; }
`

const BODY: BodyAttributes = {
  bgcolor: '#ffffff',
  text: '#000000',
  link: '#0033aa',
  vlink: '#5a2a8c',
  alink: '#cc3300',
}

const Sidebar = (props: { readonly current: string }) => (
  <>
    <table class="side" width="100%" cellpadding="5" cellspacing="1" border="0" bgcolor="#b8c7de">
      <tr>
        <td bgcolor="#2a5ba8">
          <font color="#ffffff">
            <b>In This Guide</b>
          </font>
        </td>
      </tr>
      {CHAPTERS.map((chapter, i) => (
        <tr>
          <td class="side" bgcolor={chapter.slug === props.current ? '#ffffff' : '#eef2f8'}>
            {chapter.slug === props.current ? (
              <b>
                {i + 1}. {chapter.title}
              </b>
            ) : (
              <a href={chapterAddress(chapter.slug)}>
                {i + 1}. {chapter.title}
              </a>
            )}
          </td>
        </tr>
      ))}
    </table>
    <br />
    <table class="side" width="100%" cellpadding="5" cellspacing="1" border="0" bgcolor="#b8c7de">
      <tr>
        <td bgcolor="#2a5ba8">
          <font color="#ffffff">
            <b>See Also</b>
          </font>
        </td>
      </tr>
      <tr>
        <td bgcolor="#eef2f8">
          <a href={HELP_HOME}>Help Contents</a>
        </td>
      </tr>
      <tr>
        <td bgcolor="#eef2f8">
          <a href={`${HELP_HOME}protocol/`}>The Pigeon Protocol</a>
          <br />
          <span class="small">the full spec, for the curious</span>
        </td>
      </tr>
    </table>
  </>
)

/** A chapter of the guide, in the shared frame. `body` is the chapter's content. */
export function chapterPage(slug: string, body: Child): HelpPage {
  const index = CHAPTERS.findIndex((chapter) => chapter.slug === slug)
  const chapter = CHAPTERS[index]
  if (chapter === undefined) throw new Error(`No chapter ${slug}`)
  const next = CHAPTERS[index + 1]
  const prev = CHAPTERS[index - 1]
  return helpDocument({
    title: `${chapter.title} - How Pigeon Works`,
    style: STYLE,
    bodyAttributes: BODY,
    body: (
      <>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td bgcolor="#1f3f73">
              <table width="100%" cellpadding="10" cellspacing="0" border="0">
                <tr>
                  <td>
                    <font face="Arial, Helvetica, sans-serif" color="#ffffff" size="5">
                      <b>How Pigeon Works</b>
                    </font>
                    <br />
                    <font color="#c9d8f0" size="1">
                      Plain answers about the messenger with nobody in the middle
                    </font>
                  </td>
                  <td align="right" valign="bottom">
                    <font color="#c9d8f0" size="1">
                      Chapter {index + 1} of {CHAPTERS.length}
                    </font>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#dde6f3">
              <table width="100%" cellpadding="4" cellspacing="0" border="0">
                <tr>
                  <td class="trail">
                    <a href={HELP_HOME}>Help</a> &gt;{' '}
                    {slug === '' ? (
                      'How Pigeon Works'
                    ) : (
                      <>
                        <a href={HOW_HOME}>How Pigeon Works</a> &gt; {chapter.title}
                      </>
                    )}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="12" cellspacing="0" border="0">
          <tr>
            <td width="180" valign="top" bgcolor="#f6f8fb">
              <Sidebar current={slug} />
            </td>
            <td valign="top">
              <h1>{chapter.title}</h1>
              {body}
              <br />
              <hr size="1" noshade />
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left">
                    {prev ? (
                      <a href={chapterAddress(prev.slug)}>&lt;&lt; {prev.title}</a>
                    ) : (
                      <>&nbsp;</>
                    )}
                  </td>
                  <td align="right">
                    {next ? (
                      <a href={chapterAddress(next.slug)}>Next: {next.title} &gt;&gt;</a>
                    ) : (
                      <a href={HELP_HOME}>Back to Help Contents &gt;&gt;</a>
                    )}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="6" cellspacing="0" border="0">
          <tr>
            <td bgcolor="#dde6f3" align="center" class="small">
              How Pigeon Works is part of Pigeon's Help. It came with Pigeon and lives on this
              computer, so it opens with nobody online.
            </td>
          </tr>
        </table>
      </>
    ),
  })
}

/** Numbered steps, each a cell of the page's content. */
export const Steps = (props: { readonly items: readonly Child[] }) => (
  <table width="100%" cellpadding="7" cellspacing="2" border="0">
    {props.items.map((item, i) => (
      <tr>
        <td width="30" align="center" valign="top" bgcolor="#2a5ba8">
          <font face="Arial, Helvetica, sans-serif" color="#ffffff" size="4">
            <b>{i + 1}</b>
          </font>
        </td>
        <td valign="top" bgcolor={i % 2 === 0 ? '#f4f7fb' : '#ffffff'}>
          {item}
        </td>
      </tr>
    ))}
  </table>
)

/** A numbered figure: a diagram in a ruled box, its caption below. */
export const Figure = (props: {
  readonly number: number
  readonly caption: Child
  readonly children?: Child
}) => (
  <>
    <table width="100%" cellpadding="10" cellspacing="0" border="1">
      <tr>
        <td bgcolor="#fffef2">{props.children}</td>
      </tr>
      <tr>
        <td bgcolor="#eeeeee" class="caption">
          <b>Figure {props.number}.</b> {props.caption}
        </td>
      </tr>
    </table>
    <br />
  </>
)

/** A box beside the text: "Good to know", "Watch out" and the like. */
export const Aside = (props: {
  readonly title: string
  readonly color?: string
  readonly children?: Child
}) => (
  <>
    <table
      width="100%"
      cellpadding="8"
      cellspacing="0"
      border="0"
      bgcolor={props.color ?? '#fff6d5'}
    >
      <tr>
        <td>
          <b>{props.title}</b>
          <br />
          {props.children}
        </td>
      </tr>
    </table>
    <br />
  </>
)

/** A row of labelled boxes joined by arrows, drawn with table cells. */
export const Flow = (props: {
  readonly boxes: readonly { readonly label: string; readonly note: Child }[]
}) => (
  <table cellpadding="0" cellspacing="0" border="0">
    <tr>
      {props.boxes.map((box, i) => (
        <>
          {i > 0 && (
            <td valign="middle" align="center" width="36">
              <b>--&gt;</b>
            </td>
          )}
          <td valign="middle">
            <table cellpadding="6" cellspacing="0" border="1" bgcolor="#e8eef7">
              <tr>
                <td align="center">
                  <b>{box.label}</b>
                  <br />
                  <span class="small">{box.note}</span>
                </td>
              </tr>
            </table>
          </td>
        </>
      ))}
    </tr>
  </table>
)

/** The mark on anything Pigeon doesn't do yet. */
export const NOT_BUILT = (
  <font color="#aa0000">
    <b>[Not built yet]</b>
  </font>
)
