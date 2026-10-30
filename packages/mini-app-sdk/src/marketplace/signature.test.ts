import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'

import {
  marketplaceSignatureState,
  publicKeyOf,
  signMarketplace,
  verifyMarketplaceSignature,
} from './signature'

const keyPair = () => generateKeyPairSync('ed25519').privateKey
const bytes = new TextEncoder().encode('{"schema":3,"name":"ada"}\n')

describe('signing a released marketplace', () => {
  test('each key signs the exact bytes, and each signature names its key', () => {
    const oldKey = keyPair()
    const newKey = keyPair()
    const signatures = signMarketplace(bytes, [oldKey, newKey])
    expect(verifyMarketplaceSignature(bytes, signatures)).toEqual({
      keys: [publicKeyOf(oldKey), publicKeyOf(newKey)],
    })
  })

  test('a changed byte leaves no signature holding', () => {
    const signatures = signMarketplace(bytes, [keyPair()])
    const changed = new TextEncoder().encode('{"schema":3,"name":"eve"}\n')
    expect(verifyMarketplaceSignature(changed, signatures)).toEqual({ keys: [] })
  })

  test('a signature of an algorithm this Localix does not know is passed over', () => {
    const key = keyPair()
    const file = JSON.parse(signMarketplace(bytes, [key]))
    file.signatures.unshift({ algorithm: 'ml-dsa-65', key: 'AAAA', signature: 'BBBB' })
    expect(verifyMarketplaceSignature(bytes, JSON.stringify(file))).toEqual({
      keys: [publicKeyOf(key)],
    })
  })

  test('a file that is not a signature file says so', () => {
    expect(verifyMarketplaceSignature(bytes, 'not json')).toEqual({
      problem: 'the signature file is not JSON',
    })
    expect(verifyMarketplaceSignature(bytes, '{"schema":1,"algorithm":"ed25519"}')).toEqual({
      problem: 'the signature file is not a schema 2 marketplace signature',
    })
  })

  test('the private key is read as PEM too, as a CI secret holds it', () => {
    const key = keyPair()
    const pem = key.export({ format: 'pem', type: 'pkcs8' }).toString()
    expect(verifyMarketplaceSignature(bytes, signMarketplace(bytes, [pem]))).toEqual({
      keys: [publicKeyOf(key)],
    })
  })
})

describe('what a signature means against the keys kept for a marketplace', () => {
  const [a, b] = ['a', 'b'].map(() => publicKeyOf(keyPair()))

  test('signed when a kept key signed it', () => {
    expect(marketplaceSignatureState({ keys: [b!, a!] }, [a!])).toBe('signed')
  })

  test('not signed while no key is kept, whatever is beside it', () => {
    expect(marketplaceSignatureState({ keys: [a!] }, [])).toBe('unsigned')
    expect(marketplaceSignatureState({ keys: [] }, [])).toBe('unsigned')
  })

  test('changed when keys are kept and none of them signed it', () => {
    expect(marketplaceSignatureState({ keys: [b!] }, [a!])).toBe('mismatch')
    expect(marketplaceSignatureState({ keys: [] }, [a!])).toBe('mismatch')
    expect(marketplaceSignatureState({ problem: 'unreadable' }, [a!])).toBe('mismatch')
  })
})
