import { render, screen } from '@solidjs/testing-library'
import { expect, it, vi } from 'vitest'
import { LayoutContext } from '../layout/layout.ts'
import styles from './message-box.module.css'
import { MessageBox } from './message-box.tsx'

const box = () => (
  <MessageBox kind="information" buttons={[{ label: 'OK', isDefault: true, onClick: vi.fn() }]}>
    <p>Letters is still being built.</p>
  </MessageBox>
)

it('is a compact dialog on the desktop and a full page with a wide button on a phone', () => {
  const { unmount } = render(box)
  const desktop = screen.getByRole('button', { name: 'OK' })
  expect(desktop.className).not.toContain(styles.wide)
  unmount()

  render(() => <LayoutContext.Provider value="phone">{box()}</LayoutContext.Provider>)
  const phone = screen.getByRole('button', { name: 'OK' })
  expect(phone.className).toContain(styles.wide)
  expect(phone.closest(`.${styles.phone}`)).not.toBeNull()
})
