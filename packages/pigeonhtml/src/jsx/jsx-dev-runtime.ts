// What a development build of a page calls instead of `jsx`: the same, since a page's elements
// carry nothing extra to check in development. It is given where in the source each element is
// (`isStatic`, `source`, `self`), and has no use for it.

import { jsx } from './jsx-runtime.ts'

export { Fragment, jsx, jsxs } from './jsx-runtime.ts'

export const jsxDEV = (
  type: Parameters<typeof jsx>[0],
  props: Parameters<typeof jsx>[1],
  key?: unknown,
  _isStatic?: boolean,
  _source?: unknown,
  _self?: unknown,
) => jsx(type, props, key)
