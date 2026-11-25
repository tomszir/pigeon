// A corpus of known XSS and mutation-XSS vectors: none may leave anything the allowlists
// don't allow, whatever `urls` lets through, and sanitizing the output again changes nothing.

import { describe, expect, it } from 'vitest'
import { sanitize } from './index.ts'
import { audit } from './testing/audit.ts'
import { anyUrls, IMAGE_PREFIX, LINK_PREFIX, servedUrls } from './testing/urls.ts'

const raw = String.raw

/** The OWASP XSS Filter Evasion Cheat Sheet's vectors, with its hosts swapped for example ones. */
const owasp = [
  '<SCRIPT SRC=https://xss.example/xss.js></SCRIPT>',
  `<IMG SRC="javascript:alert('XSS');">`,
  `<IMG SRC=javascript:alert('XSS')>`,
  `<IMG SRC=JaVaScRiPt:alert('XSS')>`,
  '<IMG SRC=javascript:alert(&quot;XSS&quot;)>',
  '<IMG SRC=`javascript:alert("RSnake says, \'XSS\'")`>',
  '<a onmouseover="alert(document.cookie)">xxs link</a>',
  '<a onmouseover=alert(document.cookie)>xxs link</a>',
  raw`<IMG """><SCRIPT>alert("XSS")</SCRIPT>"\>`,
  '<IMG SRC=javascript:alert(String.fromCharCode(88,83,83))>',
  `<IMG SRC=# onmouseover="alert('xxs')">`,
  `<IMG SRC= onmouseover="alert('xxs')">`,
  `<IMG onmouseover="alert('xxs')">`,
  '<IMG SRC=/ onerror="alert(String.fromCharCode(88,83,83))"></img>',
  '<img src=x onerror="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058&#0000097&#0000108&#0000101&#0000114&#0000116&#0000040&#0000039&#0000088&#0000083&#0000083&#0000039&#0000041">',
  '<IMG SRC=&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#39;&#88;&#83;&#83;&#39;&#41;>',
  '<IMG SRC=&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058&#0000097&#0000108&#0000101&#0000114&#0000116&#0000040&#0000039&#0000088&#0000083&#0000083&#0000039&#0000041>',
  '<IMG SRC=&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A&#x61&#x6C&#x65&#x72&#x74&#x28&#x27&#x58&#x53&#x53&#x27&#x29>',
  `<IMG SRC="jav\tascript:alert('XSS');">`,
  `<IMG SRC="jav&#x09;ascript:alert('XSS');">`,
  `<IMG SRC="jav&#x0A;ascript:alert('XSS');">`,
  `<IMG SRC="jav&#x0D;ascript:alert('XSS');">`,
  '<IMG SRC=java\0script:alert("XSS")>',
  `<IMG SRC=" &#14;  javascript:alert('XSS');">`,
  '<SCRIPT/XSS SRC="http://xss.example/xss.js"></SCRIPT>',
  '<BODY onload!#$%&()*~+-_.,:;?@[/|\\]^`=alert("XSS")>',
  '<SCRIPT/SRC="http://xss.example/xss.js"></SCRIPT>',
  raw`<<SCRIPT>alert("XSS");//\<</SCRIPT>`,
  '<SCRIPT SRC=http://xss.example/xss.js?< B >',
  '<SCRIPT SRC=//xss.example/.j>',
  `<IMG SRC="\`<javascript:alert>\`('XSS')"`,
  '<iframe src=http://xss.example/scriptlet.html <',
  raw`\";alert('XSS');//`,
  '</TITLE><SCRIPT>alert("XSS");</SCRIPT>',
  `<INPUT TYPE="IMAGE" SRC="javascript:alert('XSS');">`,
  `<BODY BACKGROUND="javascript:alert('XSS')">`,
  `<IMG DYNSRC="javascript:alert('XSS')">`,
  `<IMG LOWSRC="javascript:alert('XSS')">`,
  `<STYLE>li {list-style-image: url("javascript:alert('XSS')");}</STYLE><UL><LI>XSS</br>`,
  `<IMG SRC='vbscript:msgbox("XSS")'>`,
  `<svg/onload=alert('XSS')>`,
  `<BODY ONLOAD=alert('XSS')>`,
  `<BGSOUND SRC="javascript:alert('XSS');">`,
  `<BR SIZE="&{alert('XSS')}">`,
  `<LINK REL="stylesheet" HREF="javascript:alert('XSS');">`,
  `<STYLE>@import'http://xss.example/xss.css';</STYLE>`,
  '<META HTTP-EQUIV="Link" Content="<http://xss.example/xss.css>; REL=stylesheet">',
  '<STYLE>BODY{-moz-binding:url("http://xss.example/xssmoz.xml#xss")}</STYLE>',
  raw`<STYLE>@im\port'\ja\vasc\ript:alert("XSS")';</STYLE>`,
  `<IMG STYLE="xss:expr/*XSS*/ession(alert('XSS'))">`,
  `<STYLE TYPE="text/javascript">alert('XSS');</STYLE>`,
  `<STYLE>.XSS{background-image:url("javascript:alert('XSS')");}</STYLE><A CLASS=XSS></A>`,
  `<STYLE type="text/css">BODY{background:url("javascript:alert('XSS')")}</STYLE>`,
  '<XSS STYLE="behavior: url(xss.htc);">',
  `<META HTTP-EQUIV="refresh" CONTENT="0;url=javascript:alert('XSS');">`,
  '<META HTTP-EQUIV="refresh" CONTENT="0;url=data:text/html base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4K">',
  `<META HTTP-EQUIV="refresh" CONTENT="0; URL=http://;URL=javascript:alert('XSS');">`,
  `<IFRAME SRC="javascript:alert('XSS');"></IFRAME>`,
  `<IFRAME SRC=# onmouseover="alert(document.cookie)"></IFRAME>`,
  `<FRAMESET><FRAME SRC="javascript:alert('XSS');"></FRAMESET>`,
  `<TABLE BACKGROUND="javascript:alert('XSS')">`,
  `<TABLE><TD BACKGROUND="javascript:alert('XSS')">`,
  `<DIV STYLE="background-image: url(javascript:alert('XSS'))">`,
  raw`<DIV STYLE="background-image:\0075\0072\006C\0028'\006a\0061\0076\0061\0073\0063\0072\0069\0070\0074\003a\0061\006c\0065\0072\0074\0028.1027\0058.1053\0053\0027\0029'\0029">`,
  `<DIV STYLE="background-image: url(&#1;javascript:alert('XSS'))">`,
  `<DIV STYLE="width: expression(alert('XSS'));">`,
  `<BASE HREF="javascript:alert('XSS');//">`,
  '<BASE HREF="https://xss.example/">',
  '<OBJECT TYPE="text/x-scriptlet" DATA="http://xss.example/scriptlet.html"></OBJECT>',
  '<EMBED SRC="data:image/svg+xml;base64,PHN2ZyB4bWxuczpzdmc9Imh0dH A6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcv MjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hs aW5rIiB2ZXJzaW9uPSIxLjAiIHg9IjAiIHk9IjAiIHdpZHRoPSIxOTQiIGhlaWdodD0iMjAw IiBpZD0ieHNzIj48c2NyaXB0IHR5cGU9InRleHQvZWNtYXNjcmlwdCI+YWxlcnQoIlh TUyIpOzwvc2NyaXB0Pjwvc3ZnPg==" type="image/svg+xml" AllowScriptAccess="always"></EMBED>',
  '<HTML xmlns:xss><?import namespace="xss" implementation="http://xss.example/xss.htc"><xss:xss>XSS</xss:xss></HTML>',
  `<XML ID="xss"><I><B><IMG SRC="javas<!-- -->cript:alert('XSS')"></B></I></XML>`,
  `<HEAD><META HTTP-EQUIV="CONTENT-TYPE" CONTENT="text/html; charset=UTF-7"> </HEAD>+ADw-SCRIPT+AD4-alert('XSS');+ADw-/SCRIPT+AD4-`,
  `<!--[if gte IE 4]><SCRIPT>alert('XSS');</SCRIPT><![endif]-->`,
  '<A HREF="http://0x42.0x0000066.0x7.0x93/">XSS</A>',
  '<A HREF="h\ntt\tp://6\t6.000146.0x7.147/">XSS</A>',
]

/** `javascript:` hidden by entities, whitespace, controls and case. */
const obfuscatedJavascript = [
  '<a href="&#1;javascript:alert(1)">x</a>',
  '<a href="  javascript:alert(1)">x</a>',
  '<a href="javascript&colon;alert(1)">x</a>',
  '<a href="jav&Tab;ascript:alert(1)">x</a>',
  '<a href="jav&NewLine;ascript&colon;alert(1)">x</a>',
  '<a href="&#x6A;avascript:alert(1)">x</a>',
  '<a href="&#106avascript:alert(1)">x</a>',
  '<a href="JAVASCRIPT:alert(1)">x</a>',
  '<a href="\u0001\u0002javascript:alert(1)">x</a>',
  '<a href="java\u0000script:alert(1)">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="livescript:alert(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<a href="DaTa:text/html,<script>alert(1)</script>">x</a>',
  '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
  '<img src="data:text/html,<script>alert(1)</script>">',
  '<area href="javascript:alert(1)" shape=rect coords="0,0,9,9">',
  '<table background="java&#09;script:alert(1)"><tr><td>x</td></tr></table>',
  raw`<p style="background: url('jav\61 script:alert(1)')">x</p>`,
  raw`<p style="background: u\72l(javascript:alert(1))">x</p>`,
  raw`<p style="background: url(javascript\3a alert(1))">x</p>`,
]

/** Mutation XSS: markup that reads one way to a sanitizer and another way once re-parsed. */
const mutation = [
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<noscript><img src=x onerror=alert(1)></noscript>',
  '<textarea><img src=x onerror=alert(1)></textarea>',
  '<textarea></textarea><img src=x onerror=alert(1)>',
  '<title><img src=x onerror=alert(1)></title>',
  '<title></title><img src=x onerror=alert(1)><title>',
  '<style><img src=x onerror=alert(1)></style>',
  '<style></style><img src=x onerror=alert(1)>',
  '<style>a{color:red}</style ><script>alert(1)</script>',
  raw`<style>p:before { content: "\3c /style\3e \3c script\3e alert(1)\3c /script\3e" }</style>`,
  raw`<p style="font-family: '\3c /style\3e \3c script\3e alert(1)'">x</p>`,
  '<style>a { content: "</style><img src=x onerror=alert(1)>" }</style>',
  '<xmp><img src=x onerror=alert(1)></xmp>',
  '<xmp></xmp><img src=x onerror=alert(1)>',
  '<template><img src=x onerror=alert(1)></template>',
  '<template><script>alert(1)</script></template>',
  '<noembed><img title="</noembed><img src onerror=alert(1)>"></noembed>',
  '<noframes><img title="</noframes><img src onerror=alert(1)>"></noframes>',
  '<iframe><img title="</iframe><img src onerror=alert(1)>"></iframe>',
  '<plaintext><img src=x onerror=alert(1)>',
  '<listing>&lt;img src=x onerror=alert(1)&gt;</listing>',
  '<!--<img src="--><img src=x onerror=alert(1)//">',
  '<![CDATA[><img src=x onerror=alert(1)>]]>',
  '<?xml version="1.0"?><img src=x onerror=alert(1)>',
  '<p title="</p><script>alert(1)</script>">x</p>',
  '<div title="x&quot; onmouseover=&quot;alert(1)">x</div>',
  `<a title='"><script>alert(1)</script>'>x</a>`,
  '<font face="&quot;><script>alert(1)</script>">x</font>',
  '<img src="x" alt="`` onerror=alert(1)">',
  '<p><button><p>x</p></button></p>',
  '<table><tr><td><form><tr><td>x</td></tr></form></td></tr></table>',
  '<a href="a"><section><a href="b">x</a></section></a>',
  '<pre>\n\nx</pre>',
]

/** Namespace confusion: svg and math change how the same markup parses. */
const foreign = [
  '<svg><style><img src=x onerror=alert(1)></style></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><a xlink:href="javascript:alert(1)"><text x="0" y="20">x</text></a></svg>',
  '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
  '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
  '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<math><mi><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>">',
  '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
  '<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>',
  '<math href="javascript:alert(1)">x</math>',
  '<svg><desc><style><img src=x onerror=alert(1)></style></desc></svg>',
  '<math><mtext><h1><a><h6></a></h6><mglyph><svg><mtext><style><a title="</style><img src onerror=alert(1)>"></style></h1>',
]

const vectors = [...owasp, ...obfuscatedJavascript, ...mutation, ...foreign]

describe.each([
  ['urls that let anything through', anyUrls, {}],
  [
    'urls that serve everything',
    servedUrls,
    { imagePrefix: IMAGE_PREFIX, linkPrefix: LINK_PREFIX },
  ],
])('with %s', (_, urls, options) => {
  it.each(vectors)('leaves nothing off the lists: %s', (vector) => {
    const { html } = sanitize(vector, urls)
    expect(audit(html, options)).toEqual([])
    expect(html).not.toMatch(
      /<\/?(script|svg|math|iframe|frame|object|embed|meta|base|link|form|input)\b/i,
    )
  })

  it.each(vectors)('gives the same page when sanitized again: %s', (vector) => {
    const once = sanitize(vector, urls).html
    expect(sanitize(once, urls).html).toBe(once)
  })
})

it('reports what it took out of the vectors', () => {
  const removed = (source: string) => sanitize(source, anyUrls).removed
  expect(removed('<IMG SRC=JaVaScRiPt:alert(1)>')).toEqual([
    { what: 'url', name: 'JaVaScRiPt:alert(1)' },
  ])
  expect(removed('<svg/onload=alert(1)>')).toEqual([{ what: 'element', name: 'svg' }])
  expect(removed('<a href="javascript&colon;alert(1)" onclick="x()">x</a>')).toEqual([
    { what: 'url', name: 'javascript:alert(1)' },
    { what: 'attribute', name: 'onclick' },
  ])
})
