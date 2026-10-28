import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  knownLocalTextSnapshot,
  localFileIdentity,
  rememberLocalTextSnapshot,
} from './local-text-snapshots'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'snapshots-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// On a coarse filesystem clock two same-size writes inside one tick leave the same metadata, so a
// snapshot taken in that tick cannot tell them apart: it must not be trusted, as git treats a
// "racily clean" index entry.
test('a file changed just before its snapshot is read again, not trusted', async () => {
  const file = path.join(dir, 'a.txt')
  writeFileSync(file, 'one')
  const identity = (await localFileIdentity(file))!
  rememberLocalTextSnapshot(file, identity, 'hash-one')
  expect(knownLocalTextSnapshot(file, identity, 'hash-one')).toBeNull()
})

test('a file that settled before its snapshot is trusted while its metadata holds', async () => {
  const file = path.join(dir, 'b.txt')
  writeFileSync(file, 'one')
  const identity = (await localFileIdentity(file))!
  const later = () => Date.now() + 60_000
  rememberLocalTextSnapshot(file, identity, 'hash-one', later)
  expect(knownLocalTextSnapshot(file, identity, 'hash-one')?.hash).toBe('hash-one')
  expect(knownLocalTextSnapshot(file, identity, 'hash-two')).toBeNull()
})
