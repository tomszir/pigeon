// Which layout a control is drawn in. The phone shell provides 'phone' (decision 0019); controls
// that arrange themselves differently for a finger read it. Sizes change through tokens instead.
import { createContext, useContext } from 'solid-js'

export type Layout = 'desktop' | 'phone'

export const LayoutContext = createContext<Layout>('desktop')

export const useLayout = (): Layout => useContext(LayoutContext)
