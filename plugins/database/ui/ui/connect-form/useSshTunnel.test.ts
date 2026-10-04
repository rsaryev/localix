import { describe, expect, test } from 'bun:test'
import { formHostKeyPin } from './useSshTunnel'

const PIN = 'SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0'
const edit = { host: 'bastion.example', user: 'tunnel', hostKeyFingerprint: PIN }

describe('formHostKeyPin — what the edit form sends back', () => {
  test('an untouched bastion round-trips the pin (its absence would mean "forget")', () => {
    expect(formHostKeyPin(edit, { host: 'bastion.example', port: '', forgotten: false })).toBe(PIN)
    expect(formHostKeyPin(edit, { host: ' Bastion.Example ', port: '22', forgotten: false })).toBe(
      PIN,
    )
  })

  test('"Forget host key" and a moved bastion both send no pin', () => {
    expect(formHostKeyPin(edit, { host: 'bastion.example', port: '', forgotten: true })).toBe(
      undefined,
    )
    expect(formHostKeyPin(edit, { host: 'other.example', port: '', forgotten: false })).toBe(
      undefined,
    )
    expect(formHostKeyPin(edit, { host: 'bastion.example', port: '2222', forgotten: false })).toBe(
      undefined,
    )
  })

  test('a new connection has no pin to send', () => {
    expect(formHostKeyPin(undefined, { host: 'b', port: '', forgotten: false })).toBe(undefined)
  })
})
