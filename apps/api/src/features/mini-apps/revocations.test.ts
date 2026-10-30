import { describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createMiniAppRevocations } from './revocations'
import { INSTALL_RECORD_FILE } from './store-install'
import type { Offer, OfferRead } from './store-offers'

const tempDir = tempDirPerTest('mini-app-revocations-')
const SHA = 'a'.repeat(64)

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const installRoot = tempDir()
  const revocations = createMiniAppRevocations({ db, installRoot })
  const notices = async () =>
    (
      await db
        .selectFrom('change_events')
        .select('ref_json')
        .where('entity', '=', 'mini-app')
        .execute()
    ).map((row) => JSON.parse(row.ref_json ?? 'null')?.id)
  /** An app a marketplace installed, as its install record says. */
  const installed = (name: string, marketplace: string, version = '1.0.0', sha256 = SHA) =>
    writeTree(join(installRoot, name), {
      [INSTALL_RECORD_FILE]: JSON.stringify({
        kind: 'localix-marketplace-install',
        marketplace,
        url: 'https://ada.example.test/mini-app-marketplace.json',
        version,
        sha256,
        publisher: { name: 'Ada', verified: false },
      }),
    })
  return { revocations, installed, notices, installRoot }
}

/** What a read of the marketplaces said; anything not given said nothing. */
const said = (read: Partial<OfferRead> & { offered?: string[] } = {}) => ({
  offers: new Map((read.offered ?? []).map((id) => [id, { id } as Offer])),
  revocations: read.revocations ?? [],
  blocked: read.blocked ?? [],
})

describe('apps their marketplace took back', () => {
  test('an installed app revoked whole stops, with the reason, and is announced', async () => {
    const { revocations, installed, notices } = await setup()
    installed('notes', 'ada')
    installed('timer', 'ada')
    await revocations.reconcile(
      said({
        offered: ['timer@ada'],
        revocations: [
          { id: 'notes@ada', name: 'notes', marketplace: 'ada', reason: 'Leaks notes.' },
        ],
      }),
    )
    expect(await revocations.revoked()).toEqual(new Map([['notes', 'Leaks notes.']]))
    expect(await notices()).toEqual(['notes'])
  })

  test('the same name taken back by another marketplace is another app', async () => {
    const { revocations, installed } = await setup()
    installed('notes', 'ada')
    await revocations.reconcile(
      said({
        revocations: [{ id: 'notes@bob', name: 'notes', marketplace: 'bob', reason: 'Bad.' }],
      }),
    )
    expect((await revocations.revoked()).size).toBe(0)
  })

  test('revoked by version: only the version taken back stops, and updating past it runs again', async () => {
    const { revocations, installed, notices } = await setup()
    const notes = { id: 'notes@ada', name: 'notes', marketplace: 'ada', reason: 'Broken.' }
    installed('notes', 'ada', '1.2.0')
    const read = said({ offered: ['notes@ada'], revocations: [{ ...notes, versions: ['1.2.0'] }] })
    await revocations.reconcile(read)
    expect(await revocations.revoked()).toEqual(new Map([['notes', 'Broken.']]))
    installed('notes', 'ada', '1.3.0')
    await revocations.reconcile(read)
    expect((await revocations.revoked()).size).toBe(0)
    expect(await notices()).toEqual(['notes', 'notes'])
  })

  test('a build Localix blocks stops whichever marketplace installed it', async () => {
    const { revocations, installed } = await setup()
    installed('notes', 'ada', '1.0.0', 'b'.repeat(64))
    await revocations.reconcile(said({ blocked: [{ sha256: 'b'.repeat(64), reason: 'Malware.' }] }))
    expect(await revocations.revoked()).toEqual(
      new Map([['notes', 'Localix blocks this build: Malware.']]),
    )
  })

  // Offline, a marketplace says nothing: that is not taking a revocation back.
  test('it stays stopped until its marketplace offers it again', async () => {
    const { revocations, installed, notices } = await setup()
    installed('notes', 'ada')
    const revoked = { id: 'notes@ada', name: 'notes', marketplace: 'ada', reason: 'Leaks notes.' }
    await revocations.reconcile(said({ revocations: [revoked] }))
    await revocations.reconcile(said())
    await revocations.reconcile(said({ revocations: [revoked] }))
    expect((await revocations.revoked()).size).toBe(1)
    expect(await notices()).toEqual(['notes'])
    await revocations.reconcile(said({ offered: ['notes@ada'] }))
    expect((await revocations.revoked()).size).toBe(0)
    expect(await notices()).toEqual(['notes', 'notes'])
  })

  test('one removed from this computer is forgotten', async () => {
    const { revocations, installed, installRoot } = await setup()
    installed('notes', 'ada')
    await revocations.reconcile(
      said({
        revocations: [{ id: 'notes@ada', name: 'notes', marketplace: 'ada', reason: 'Bad.' }],
      }),
    )
    rmSync(join(installRoot, 'notes'), { recursive: true })
    await revocations.reconcile(said())
    expect((await revocations.revoked()).size).toBe(0)
  })
})
