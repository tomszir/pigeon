// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readVersion, versionJson } from './version-file.ts'

describe('version.json', () => {
  it('holds the version and nothing else', () => {
    expect(JSON.parse(versionJson('0.8.2'))).toEqual({ version: '0.8.2' })
  })

  it('reads the root package.json version', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
