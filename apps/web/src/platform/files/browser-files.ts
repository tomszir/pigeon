// Files through the browser: a download for saving, a file picker for opening. Nothing leaves
// the page; the browser asks where to put it, or which one to open.
import type { Files } from './files.ts'

/** Files larger than this aren't read: no export comes near it. */
const MAX_OPEN_BYTES = 32 * 1024 * 1024

export const browserFiles: Files = {
  saveText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  },
  openText(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.addEventListener('cancel', () => resolve(undefined))
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (file === undefined || file.size > MAX_OPEN_BYTES) {
          resolve(undefined)
          return
        }
        file.text().then(resolve, () => resolve(undefined))
      })
      input.click()
    })
  },
}
