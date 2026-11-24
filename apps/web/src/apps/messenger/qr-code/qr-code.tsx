// An invite link as a QR code, drawn as crisp whole-pixel squares (decision 0008).
import { createMemo } from 'solid-js'
import { encode } from 'uqr'
import styles from './qr-code.module.css'

export interface QrCodeProps {
  text: string
  label: string
  /** Screen pixels per module. Whole numbers keep it sharp at 1×. */
  scale?: number
}

export function QrCode(props: QrCodeProps) {
  const code = createMemo(() => encode(props.text, { ecc: 'L', border: 2 }))
  const path = createMemo(() => {
    let d = ''
    code().data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`
      })
    })
    return d
  })
  const size = () => code().size * (props.scale ?? 2)

  return (
    <svg
      class={styles.qrCode}
      role="img"
      aria-label={props.label}
      width={size()}
      height={size()}
      viewBox={`0 0 ${code().size} ${code().size}`}
      shape-rendering="crispEdges"
    >
      <rect width={code().size} height={code().size} fill="#ffffff" />
      <path d={path()} fill="#000000" />
    </svg>
  )
}
