import { DEFAULT_LIMITS } from '@pigeon/lighthouse'
import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.ts'

describe('the config', () => {
  it('needs a name and a URL, and fills in the rest', () => {
    expect(parseConfig('{"name":" Homelab ","url":"wss://h.example.ts.net/"}', '/srv')).toEqual({
      name: 'Homelab',
      url: 'wss://h.example.ts.net/',
      host: '0.0.0.0',
      port: 8787,
      keyFile: '/srv/lighthouse.key',
      database: '/srv/lighthouse.sqlite',
      pass: undefined,
      trustForwardedFor: false,
      limits: DEFAULT_LIMITS,
    })
  })

  it('says which field is wrong, never guessing', () => {
    for (const [json, field] of [
      ['{"url":"wss://a.example/"}', '"name"'],
      ['{"name":"A"}', '"url"'],
      ['{"name":"A","url":"https://a.example/"}', '"url"'],
      ['{"name":"A","url":"wss://a.example/","port":70000}', '"port"'],
      ['{"name":"A","url":"wss://a.example/","limits":{"maxBytes":-1}}', '"maxBytes"'],
      ['{"name":"A","url":"wss://a.example/","pass":""}', '"pass"'],
    ] as const)
      expect(() => parseConfig(json, '/')).toThrow(field)
  })
})
