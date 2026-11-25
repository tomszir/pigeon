import { expect, it } from 'vitest'
import { PAGE_BUDGET_BYTES, validate } from './index.ts'

it('is empty for a valid page', () => {
  expect(
    validate(`<html><head><title>Hi</title>
<style>b { color: red }</style></head>
<body bgcolor="#000000"><font face="Arial">Hello</font>
<!--#include widget="counter" -->
<a href="pigeon://kestrel/links.html">links</a></body></html>`),
  ).toEqual([])
})

it('says where each problem starts, in order', () => {
  const source = [
    '<p>fine</p>',
    '  <script>alert(1)</script>',
    '<p onclick="x()" align="left">t</p>',
    '<style>',
    'b { color: red }',
    '   i { border-radius: 2px }',
    '</style>',
    '<a href="javascript:alert(1)">x</a>',
  ].join('\n')
  expect(validate(source)).toEqual([
    { line: 2, column: 3, message: "<script> isn't PigeonHTML." },
    { line: 3, column: 4, message: "The onclick attribute isn't PigeonHTML." },
    {
      line: 6,
      column: 8,
      message: "The CSS property border-radius isn't PigeonHTML, or its value isn't CSS 2.1.",
    },
    { line: 8, column: 4, message: "This address can't be used: javascript:alert(1)" },
  ])
})

it('points at the attribute for a problem in a style attribute', () => {
  expect(validate('<p>\n<b  style="box-shadow: none">x</b></p>')).toEqual([
    {
      line: 2,
      column: 5,
      message: "The CSS property box-shadow isn't PigeonHTML, or its value isn't CSS 2.1.",
    },
  ])
})

it('counts lines through CRLF and the first line of a style element', () => {
  expect(validate('<style>b { color: red }\r\nb { display: flex }</style>')).toEqual([
    {
      line: 2,
      column: 5,
      message: "The CSS property display isn't PigeonHTML, or its value isn't CSS 2.1.",
    },
  ])
  expect(validate('<p>x</p><style>@import "x.css";</style>')).toEqual([
    { line: 1, column: 16, message: "@import isn't PigeonHTML." },
  ])
})

it('reports elements from after 2003 and foreign content', () => {
  expect(validate('<section>a</section>\n<svg></svg>').map((p) => p.message)).toEqual([
    "<section> isn't PigeonHTML.",
    "<svg> isn't PigeonHTML.",
  ])
})

it('reports a page over the budget', () => {
  expect(validate(`<p>${'x'.repeat(PAGE_BUDGET_BYTES)}</p>`)).toEqual([
    { line: 1, column: 1, message: 'The page is 101 KB, over the 100 KB budget.' },
  ])
})
