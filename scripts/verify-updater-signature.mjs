#!/usr/bin/env bun
// Checks a Tauri updater signature against the public key the release build embeds.
//
//   bun scripts/verify-updater-signature.mjs <file> [<file>.sig] ...
//
// Each `<file>.sig` is what `tauri signer sign` writes: base64 of a minisign signature. An installed
// app accepts an update only when that signature verifies with its embedded key, so the release
// checks the same thing before anything is published. Minisign is Ed25519 over the file ("Ed") or
// over its BLAKE2b-512 digest ("ED", what Tauri writes), plus a global signature binding the trusted
// comment; both are checked here with node:crypto, so the check needs no Rust build.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { readUpdaterSettings } from '../apps/desktop-tauri/scripts/build-release-config.mjs'

// A throwaway key from an early configuration; its private half may be anywhere.
const PLACEHOLDER_PUBLIC_KEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCMDA4ODJGQ0Y0MUExMUIKUldRYm9VSFBMNGdBcTlxbTNpYjVUZ0JCdENQeUpYY2FsenNoS083cTQ5bXRvTnMybGI3bTRrTzQK'
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** The lines of a base64-wrapped minisign text, without the trailing empty line. */
function minisignLines(encoded, kind) {
  const text = Buffer.from(String(encoded).trim(), 'base64').toString('utf8')
  const lines = text.split('\n').map((line) => line.replace(/\r$/u, ''))
  if (!lines[0]?.startsWith('untrusted comment:')) throw new Error(`${kind} is not minisign text`)
  return lines
}

/** @param {string} encoded base64 of a minisign public key file */
export function parsePublicKey(encoded) {
  const raw = Buffer.from(minisignLines(encoded, 'public key')[1] ?? '', 'base64')
  if (raw.length !== 42 || raw.subarray(0, 2).toString('latin1') !== 'Ed') {
    throw new Error('public key is not an Ed25519 minisign key')
  }
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10) }
}

/** @param {string} encoded base64 of a minisign signature file */
export function parseSignature(encoded) {
  const lines = minisignLines(encoded, 'signature')
  const raw = Buffer.from(lines[1] ?? '', 'base64')
  const algorithm = raw.subarray(0, 2).toString('latin1')
  if (raw.length !== 74 || (algorithm !== 'Ed' && algorithm !== 'ED')) {
    throw new Error('signature is not an Ed25519 minisign signature')
  }
  const comment = lines[2] ?? ''
  if (!comment.startsWith('trusted comment: ')) throw new Error('signature has no trusted comment')
  const global = Buffer.from(lines[3] ?? '', 'base64')
  if (global.length !== 64) throw new Error('signature has no global signature')
  return {
    algorithm,
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10),
    trustedComment: comment.slice('trusted comment: '.length),
    globalSignature: global,
  }
}

/**
 * Throw unless `signature` signs `payload` with `publicKey`, the way the updater checks it.
 *
 * @param {{ payload: Buffer, signature: string, publicKey: string }} input
 */
export function verifyUpdaterSignature({ payload, signature, publicKey }) {
  if (publicKey.trim() === PLACEHOLDER_PUBLIC_KEY) {
    throw new Error('the updater public key is still the throwaway placeholder')
  }
  const key = parsePublicKey(publicKey)
  const sig = parseSignature(signature)
  if (!key.keyId.equals(sig.keyId)) {
    throw new Error('the signature was made by a different key than the updater public key')
  }
  const keyObject = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, key.key]),
    format: 'der',
    type: 'spki',
  })
  const signed =
    sig.algorithm === 'ED' ? createHash('blake2b512').update(payload).digest() : payload
  if (!verify(null, signed, keyObject, sig.signature)) {
    throw new Error('the signature does not match the file')
  }
  const comment = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, 'utf8')])
  if (!verify(null, comment, keyObject, sig.globalSignature)) {
    throw new Error('the trusted comment signature does not match')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2).filter((path) => !path.endsWith('.sig'))
  if (files.length === 0) {
    console.error('usage: verify-updater-signature.mjs <file> [<file> ...]')
    process.exit(2)
  }
  const publicKey = readUpdaterSettings().pubkey
  let failed = false
  for (const file of files) {
    try {
      verifyUpdaterSignature({
        payload: readFileSync(file),
        signature: readFileSync(`${file}.sig`, 'utf8'),
        publicKey,
      })
      console.log(`[updater-signature] ${file}: verified`)
    } catch (error) {
      console.error(
        `[updater-signature] ${file}: ${error instanceof Error ? error.message : String(error)}`,
      )
      failed = true
    }
  }
  if (failed) process.exit(1)
}
