import { describe, expect, it } from 'vitest'
import { openWithPassphrase, sealWithPassphrase } from './passphrase.ts'

const data = new TextEncoder().encode('{"friends":[]}')

describe('sealing with a passphrase', () => {
  it('opens with the same passphrase, inside a text file too', async () => {
    const sealed = await sealWithPassphrase('correct horse', data, 1000)
    expect(sealed).toMatch(/^pigeon-sealed:v1:1000:/)
    const file = `Pigeon data\nSomething to read first.\n${sealed}\n`
    expect(await openWithPassphrase('correct horse', file)).toEqual(data)
  })

  it('refuses a wrong passphrase, a changed file and text that was never sealed', async () => {
    const sealed = await sealWithPassphrase('correct horse', data, 1000)
    expect(await openWithPassphrase('wrong horse', sealed)).toBeUndefined()
    expect(await openWithPassphrase('correct horse', `${sealed.slice(0, -4)}AAA=`)).toBeUndefined()
    expect(await openWithPassphrase('correct horse', 'hello')).toBeUndefined()
  })
})
