import { describe, expect, it } from 'vitest'
import { PAGE_BUDGET_BYTES, sanitize, validate } from './index.ts'
import { MAX_DEPTH, MAX_NODES } from './sanitize.ts'
import { audit } from './testing/audit.ts'
import { anyUrls, IMAGE_PREFIX, LINK_PREFIX, servedUrls } from './testing/urls.ts'

const body = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? ''
const clean = (source: string) => body(sanitize(source, anyUrls).html)

/** A page the way they were made in 2003. */
const homepage = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<HTML>
<HEAD>
<TITLE>~*~ Kestrel's Home Page ~*~</TITLE>
<META NAME="keywords" CONTENT="pigeons, gifs">
<STYLE TYPE="text/css">
<!--
body { font-family: Verdana, Arial, sans-serif; font-size: 10pt }
a:hover { color: #ff00ff; text-decoration: underline }
.box { border: 2px outset #c0c0c0; background: url(stars.gif) }
-->
</STYLE>
<SCRIPT>window.status = 'Welcome!!'</SCRIPT>
</HEAD>
<BODY BGCOLOR="#000080" TEXT="#FFFF00" LINK="#00FFFF" VLINK="#FF00FF" BACKGROUND="stars.gif" ONLOAD="hello()">
<CENTER><FONT FACE="Comic Sans MS" SIZE="5" COLOR="lime">Welcome to my page!</FONT></CENTER>
<MARQUEE BEHAVIOR="alternate" SCROLLAMOUNT="3">Under construction</MARQUEE>
<BLINK>NEW!</BLINK>
<!--#include widget="counter" -->
<TABLE BORDER="1" CELLPADDING="4" CELLSPACING="0" WIDTH="100%">
<TR><TD BGCOLOR="#C0C0C0" VALIGN="top"><IMG SRC="pigeon.gif" ALT="A pigeon" WIDTH="88" HEIGHT="31" BORDER="0"></TD>
<TD class="box" style="color: white; border-radius: 9px"><A HREF="links.html" TARGET="_blank">My links</A></TD></TR>
</TABLE>
<HR NOSHADE SIZE="1">
<P ALIGN="center">Best viewed in Pigeon Explorer at 800x600</P>
</BODY>
</HTML>`

describe('sanitize', () => {
  it('keeps a 2003 page as it was made', () => {
    const { html, title, removed } = sanitize(homepage, servedUrls)
    expect(title).toBe("~*~ Kestrel's Home Page ~*~")
    expect(html).toContain(
      '<font face="Comic Sans MS" size="5" color="lime">Welcome to my page!</font>',
    )
    expect(html).toContain(
      '<marquee behavior="alternate" scrollamount="3">Under construction</marquee>',
    )
    expect(html).toContain('<blink>NEW!</blink>')
    expect(html).toContain(
      `<body bgcolor="#000080" text="#FFFF00" link="#00FFFF" vlink="#FF00FF" background="${IMAGE_PREFIX}stars.gif">`,
    )
    expect(html).toContain(
      `<img src="${IMAGE_PREFIX}pigeon.gif" alt="A pigeon" width="88" height="31" border="0">`,
    )
    expect(html).toContain(`<a href="${LINK_PREFIX}links.html">My links</a>`)
    expect(html).toContain('<td class="box" style="color: white">')
    expect(html).toContain('a:hover { color: #ff00ff; text-decoration: underline }')
    expect(html).toContain(
      `.box { border: 2px outset #c0c0c0; background: url("${IMAGE_PREFIX}stars.gif") }`,
    )
    expect(removed).toEqual([
      { what: 'element', name: 'meta' },
      { what: 'element', name: 'script' },
      { what: 'attribute', name: 'onload' },
      { what: 'comment', name: '#comment' },
      { what: 'property', name: 'border-radius' },
      { what: 'attribute', name: 'target' },
    ])
    expect(audit(html, { imagePrefix: IMAGE_PREFIX, linkPrefix: LINK_PREFIX })).toEqual([])
  })

  it('writes no doctype', () => {
    const { html } = sanitize('<!DOCTYPE html><p>x</p>', anyUrls)
    expect(html).toBe('<html><head></head><body><p>x</p></body></html>')
  })

  it('drops comments, widgets included, and reports them', () => {
    const { html, removed } = sanitize(
      '<p>a<!-- b -->c</p><!--#include widget="guestbook" -->',
      anyUrls,
    )
    expect(body(html)).toBe('<p>ac</p>')
    expect(removed).toEqual([
      { what: 'comment', name: '#comment' },
      { what: 'comment', name: '#comment' },
    ])
  })

  it('drops dangerous elements with what is inside them, and unwraps unknown ones', () => {
    expect(clean('<script>alert(1)</script><iframe>x</iframe><object>y</object>ok')).toBe('ok')
    expect(clean('<section><article>kept <b>bold</b></article></section>')).toBe('kept <b>bold</b>')
    expect(clean('<svg><text>gone</text></svg><math><mi>x</mi></math>')).toBe('')
  })

  it('takes the form tags and controls out and keeps the text', () => {
    expect(
      clean(
        '<form action="http://x.example/"><b>Name:</b> <input name="n"><button>Go</button></form>',
      ),
    ).toBe('<b>Name:</b> Go')
  })

  it('drops on* handlers and attributes off the list', () => {
    expect(
      clean('<p onclick="x()" onmouseover="y()" align="center" data-x="1" contenteditable>t</p>'),
    ).toBe('<p align="center">t</p>')
  })

  it('drops a named image, which would shadow the frame document', () => {
    expect(clean('<img src="a.gif" name="getElementById">')).toBe('<img src="a.gif">')
  })

  it('escapes text and attributes', () => {
    expect(clean('<p title="a &quot;b&quot; <c>">1 &lt; 2 &amp; 3</p>')).toBe(
      '<p title="a &quot;b&quot; &lt;c&gt;">1 &lt; 2 &amp; 3</p>',
    )
  })

  it('keeps a <pre> that starts with a blank line', () => {
    const once = sanitize('<pre>\n\nx</pre>', anyUrls).html
    expect(body(once)).toBe('<pre>\n\nx</pre>')
  })
})

describe('deep nesting', () => {
  it('drops what is nested too deep instead of running out of stack', () => {
    const page = `${'<div>'.repeat(8_000)}x${'</div>'.repeat(8_000)}`
    const { html, removed } = sanitize(page, anyUrls)
    expect(html.match(/<div>/g)?.length).toBe(MAX_DEPTH)
    expect(removed).toEqual([{ what: 'element', name: 'div' }])
    expect(sanitize(html, anyUrls).html).toBe(html)
  })

  it('copes with CSS nested far too deep', () => {
    const deep = `${'('.repeat(20_000)}${')'.repeat(20_000)}`
    const { html } = sanitize(
      `<style>b { color: red } i ${deep} { color: red }</style><p style="color: rgb${deep}">x</p>`,
      anyUrls,
    )
    expect(html).toBe(
      '<html><head><style>b { color: red }</style></head><body><p>x</p></body></html>',
    )
  })
})

describe('limits', () => {
  const nothing = {
    html: '<html><head></head><body></body></html>',
    title: undefined,
    removed: [{ what: 'element', name: '#document' }],
  }

  it('refuses a page over the budget without parsing it', () => {
    const page = `<p>${'x'.repeat(PAGE_BUDGET_BYTES)}</p>`
    expect(sanitize(page, anyUrls)).toEqual({ ...nothing, bytes: PAGE_BUDGET_BYTES + 7 })
    expect(validate(page)).toHaveLength(1)
  })

  it('refuses a small page that makes the parser rebuild open tags over and over', () => {
    const open = Array.from({ length: 250 }, (_, i) => `<b id=${i}>`).join('')
    const page = `<div>${open}</div>${'<div>x</div>'.repeat(7_000)}`
    expect(page.length).toBeLessThan(PAGE_BUDGET_BYTES)
    const started = Date.now()
    expect(sanitize(page, anyUrls).removed).toEqual(nothing.removed)
    expect(validate(page)[0]?.message).toContain(`${MAX_NODES} elements`)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('validates a long stylesheet in linear time', () => {
    const page = `<style>a{${'x:y;\n'.repeat(15_000)}}</style>`
    const started = Date.now()
    const problems = validate(page)
    expect(problems).toHaveLength(15_000)
    expect(problems.at(-1)).toMatchObject({ line: 15_000 })
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('urls', () => {
  it('drops an image urls.image refuses, and reports it', () => {
    const { html, removed } = sanitize('<p>a<img src="x.gif">b</p>', {
      image: () => undefined,
      link: (href) => href,
    })
    expect(body(html)).toBe('<p>ab</p>')
    expect(removed).toEqual([{ what: 'url', name: 'x.gif' }])
  })

  it('keeps the text of a link urls.link refuses', () => {
    const { html, removed } = sanitize('<a href="far.html" name="top">Far</a>', {
      image: (src) => src,
      link: () => undefined,
    })
    expect(body(html)).toBe('<a name="top">Far</a>')
    expect(removed).toEqual([{ what: 'url', name: 'far.html' }])
  })

  it('refuses a scripted URL even when urls would let it through', () => {
    expect(clean('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
    const sneaky = { image: () => 'javascript:alert(1)', link: () => 'javascript:alert(1)' }
    expect(body(sanitize('<a href="ok.html">x</a><img src="ok.gif">', sneaky).html)).toBe(
      '<a>x</a>',
    )
  })

  it('lets only GIF, JPEG and PNG through as data: images', () => {
    expect(clean('<img src="data:image/gif;base64,R0lGOD">')).toBe(
      '<img src="data:image/gif;base64,R0lGOD">',
    )
    expect(clean('<img src="data:image/svg+xml,<svg>">')).toBe('')
  })

  it('sends background, src and href through urls, and no other attribute holds a URL', () => {
    const seen: string[] = []
    const urls = {
      image: (src: string) => {
        seen.push(`image ${src}`)
        return src
      },
      link: (href: string) => {
        seen.push(`link ${href}`)
        return href
      },
    }
    sanitize(
      '<body background="b.gif"><table background="t.gif"><tr><td background="c.gif"><a href="l.html">l</a><img src="i.gif" lowsrc="lo.gif" longdesc="d.html"><blockquote cite="c.html">q</blockquote><p style="background: url(s.gif)">s</p></td></tr></table></body>',
      urls,
    )
    expect(seen).toEqual([
      'image b.gif',
      'image t.gif',
      'image c.gif',
      'link l.html',
      'image i.gif',
      'image s.gif',
    ])
  })
})

describe('image maps', () => {
  it('keeps a map, its areas and an image pointing at it', () => {
    expect(
      clean(
        '<map name="nav"><area href="a.html" shape="rect" coords="0,0,10,10" alt="A"></map><img src="nav.gif" usemap="#nav">',
      ),
    ).toBe(
      '<map name="nav"><area href="a.html" shape="rect" coords="0,0,10,10" alt="A"></map><img src="nav.gif" usemap="#nav">',
    )
  })

  it('drops a usemap that is anything but a map name', () => {
    expect(clean('<img src="x.gif" usemap="other.html#nav">')).toBe('<img src="x.gif">')
  })
})

describe('framesets', () => {
  it('are dropped, frames and all', () => {
    const { html, removed } = sanitize(
      '<frameset cols="20%,80%"><frame src="nav.html"><frame src="main.html"><noframes>Get a browser</noframes></frameset>',
      anyUrls,
    )
    expect(html).toBe('<html><head></head><body></body></html>')
    expect(removed).toEqual([{ what: 'element', name: 'frameset' }])
  })
})

describe('title', () => {
  it('is the <title> as text, whitespace collapsed', () => {
    expect(sanitize('<title>\n  My   Page &amp; Co\n</title>', anyUrls).title).toBe('My Page & Co')
  })

  it('is undefined without one', () => {
    expect(sanitize('<p>x</p>', anyUrls).title).toBeUndefined()
    expect(sanitize('<title>  </title>', anyUrls).title).toBeUndefined()
  })

  it('is the first one, and stays in the head', () => {
    const { html, title } = sanitize('<title>One</title><p>x</p><title>Two</title>', anyUrls)
    expect(title).toBe('One')
    expect(html).toBe('<html><head><title>One</title></head><body><p>x</p></body></html>')
  })

  it('keeps markup in it as text', () => {
    const { html, title } = sanitize('<title><b>Hi</b></title>', anyUrls)
    expect(title).toBe('<b>Hi</b>')
    expect(html).toContain('<title>&lt;b&gt;Hi&lt;/b&gt;</title>')
  })
})

describe('bytes', () => {
  it('is the source size in UTF-8', () => {
    expect(sanitize('', anyUrls).bytes).toBe(0)
    expect(sanitize('<p>é鳩🐦</p>', anyUrls).bytes).toBe(7 + 2 + 3 + 4)
  })

  it('is measured against a 100 KB budget', () => {
    expect(PAGE_BUDGET_BYTES).toBe(102400)
    expect(sanitize('x'.repeat(PAGE_BUDGET_BYTES + 1), anyUrls).bytes).toBe(PAGE_BUDGET_BYTES + 1)
  })
})

describe('the output', () => {
  const pages = [
    homepage,
    '<p><button><p>x</p></button></p>',
    '<table><tr><td>a<section><td>b</section></td></tr></table>',
    '<a href="1"><div><a href="2">x</a></div></a>',
    '<ul><li>a<li>b</ul><dl><dt>t<dd>d</dl>',
    '<p>a<blockquote>b</p>c',
    '<b><i>x</b>y</i>',
    '<style>b{color:red}</style><table><style>i{color:blue}</style><tr><td>x</table>',
  ]

  it.each(pages)('gives the same page when sanitized again: %s', (page) => {
    const once = sanitize(page, servedUrls).html
    expect(sanitize(once, servedUrls).html).toBe(once)
  })

  it.each(pages)('parses back to nothing off the lists: %s', (page) => {
    expect(
      audit(sanitize(page, servedUrls).html, {
        imagePrefix: IMAGE_PREFIX,
        linkPrefix: LINK_PREFIX,
      }),
    ).toEqual([])
  })
})
