import { describe, expect, it } from 'vitest'
import { isPublicLighthouseUrl } from './address.ts'

describe('isPublicLighthouseUrl', () => {
  it('takes a name or address on the public internet', () => {
    for (const url of [
      'wss://lighthouse.pigeon.tomszir.com/',
      'wss://home.example.ts.net',
      'wss://93.184.216.34:8443/mail',
      'wss://[2606:4700::6810:84e5]/',
      'wss://8.8.8.8',
    ])
      expect(isPublicLighthouseUrl(url), url).toBe(true)
  })

  it('refuses loopback, private, link-local and shared addresses', () => {
    for (const url of [
      'wss://127.0.0.1/',
      'wss://10.1.2.3',
      'wss://172.16.0.1',
      'wss://172.31.255.255',
      'wss://192.168.1.1:8080/',
      'wss://169.254.169.254/',
      'wss://100.64.0.1',
      'wss://0.0.0.0',
      'wss://224.0.0.1',
      'wss://255.255.255.255',
      'wss://192.0.2.1',
    ])
      expect(isPublicLighthouseUrl(url), url).toBe(false)
  })

  it('reads IPv4 hosts the way a browser does', () => {
    for (const url of [
      'wss://127.1',
      'wss://0x7f.0.0.1',
      'wss://0x7f000001',
      'wss://2130706433',
      'wss://0177.0.0.1',
      'wss://10.0x10203',
      'wss://192.168.257',
    ])
      expect(isPublicLighthouseUrl(url), url).toBe(false)
    // 0x08080808 is 8.8.8.8: public, however it's written.
    expect(isPublicLighthouseUrl('wss://0x08080808')).toBe(true)
    // Not an address a browser would open.
    expect(isPublicLighthouseUrl('wss://1.2.3.4.5')).toBe(false)
    expect(isPublicLighthouseUrl('wss://08.1.1.1')).toBe(false)
  })

  it('refuses loopback, unique-local, link-local and IPv4-mapped IPv6', () => {
    for (const url of [
      'wss://[::1]/',
      'wss://[::]',
      'wss://[fd00::1]',
      'wss://[fc12:3456::1]',
      'wss://[fe80::1]',
      'wss://[ff02::1]',
      'wss://[::ffff:7f00:1]',
      'wss://[::ffff:c0a8:101]',
      'wss://[64:ff9b::a00:1]',
      'wss://[2001:db8::1]',
      'wss://[3fff:1::1]',
      'wss://[2001::1]',
      'wss://[2001:2::1]',
      'wss://[2002:c0a8:101::1]',
      'wss://[1:2:3:4:5:6:7:8:9]',
    ])
      expect(isPublicLighthouseUrl(url), url).toBe(false)
  })

  it('refuses names that only mean something inside a network', () => {
    for (const url of [
      'ws://localhost:8787/',
      'wss://localhost',
      'wss://pigeon.localhost',
      'wss://router',
      'wss://nas.local',
      'wss://box.home.arpa',
      'wss://printer.lan',
      'wss://metadata.google.internal',
      'wss://LOCALHOST',
      'wss://hidden.onion',
      'wss://lighthouse.example',
    ])
      expect(isPublicLighthouseUrl(url), url).toBe(false)
  })

  it('refuses ws:// anywhere, since only a Lighthouse on this computer may use it', () => {
    expect(isPublicLighthouseUrl('ws://127.0.0.1:8787')).toBe(false)
    expect(isPublicLighthouseUrl('ws://lighthouse.example.com')).toBe(false)
  })
})
