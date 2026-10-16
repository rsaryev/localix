import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { verifyUpdaterSignature } from './verify-updater-signature.mjs'

// Made by `tauri signer generate` and `tauri signer sign`; the private key was never kept.
const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dir, 'fixtures/updater-signature', name))
const payload = fixture('payload.txt')
const signature = fixture('payload.txt.sig').toString('utf8')
const publicKey = fixture('key.pub').toString('utf8')

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

/** A minisign key pair and a legacy ("Ed", unhashed) signature made with node:crypto. */
function legacySigned(data: Buffer) {
  const { publicKey: pub, privateKey } = generateKeyPairSync('ed25519')
  const raw = pub.export({ format: 'der', type: 'spki' }).subarray(-32)
  const keyId = Buffer.from('0102030405060708', 'hex')
  const key = Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')
  const detached = sign(null, data, privateKey)
  const comment = 'timestamp:1\tfile:data'
  const global = sign(null, Buffer.concat([detached, Buffer.from(comment)]), privateKey)
  const sig = Buffer.concat([Buffer.from('Ed'), keyId, detached]).toString('base64')
  return {
    publicKey: base64(`untrusted comment: test key\n${key}\n`),
    signature: base64(
      `untrusted comment: test\n${sig}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`,
    ),
  }
}

describe('updater signature verification', () => {
  test('accepts a signature written by the Tauri signer', () => {
    expect(() => verifyUpdaterSignature({ payload, signature, publicKey })).not.toThrow()
  })

  test('rejects a changed file', () => {
    expect(() =>
      verifyUpdaterSignature({ payload: Buffer.from('changed'), signature, publicKey }),
    ).toThrow('the signature does not match the file')
  })

  test('rejects a signature from another key', () => {
    const other = legacySigned(payload)
    expect(() =>
      verifyUpdaterSignature({ payload, signature, publicKey: other.publicKey }),
    ).toThrow('different key')
  })

  test('rejects a forged trusted comment', () => {
    const text = Buffer.from(signature, 'base64').toString('utf8')
    const forged = base64(text.replace('file:payload.txt', 'file:other.txt'))
    expect(() => verifyUpdaterSignature({ payload, signature: forged, publicKey })).toThrow(
      'trusted comment',
    )
  })

  test('accepts the legacy unhashed algorithm too', () => {
    const data = Buffer.from('legacy payload')
    const legacy = legacySigned(data)
    expect(() => verifyUpdaterSignature({ payload: data, ...legacy })).not.toThrow()
  })

  test('rejects the throwaway placeholder key and text that is not minisign', () => {
    const placeholder =
      'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCMDA4ODJGQ0Y0MUExMUIKUldRYm9VSFBMNGdBcTlxbTNpYjVUZ0JCdENQeUpYY2FsenNoS083cTQ5bXRvTnMybGI3bTRrTzQK'
    expect(() => verifyUpdaterSignature({ payload, signature, publicKey: placeholder })).toThrow(
      'placeholder',
    )
    expect(() =>
      verifyUpdaterSignature({ payload, signature: base64('not a signature'), publicKey }),
    ).toThrow('not minisign text')
  })
})
