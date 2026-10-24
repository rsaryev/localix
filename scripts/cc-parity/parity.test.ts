import { expect, test } from 'bun:test'
import { tempDirPerTest } from '@localixai/testing'

import { parity, STATUS } from './lib/compare.mjs'
import { parityInputs } from './lib/recording.mjs'
import { observeLocalix } from './localix/drive'

/**
 * Localix against the newest committed Claude Code snapshot: the probe mod runs in Localix's mods
 * host here, as `run.mjs localix` runs it, and each entry `checked.json` lists must have the
 * shape Claude Code was seen to give. A known gap (`known-gaps.json`) that now matches is stale.
 */

const scratch = tempDirPerTest('cc-parity', {})
const { version, claude, checked, known } = parityInputs()

test(`Localix answers the checked entries in Claude Code ${version}'s shapes`, async () => {
  const rows = parity(claude, await observeLocalix(scratch()), { known })
  const status = new Map(rows.map((row) => [row.key, row]))
  const broken = checked.flatMap((key: string) => {
    const row = status.get(key)
    if (row?.status === STATUS.same) return []
    return [`${key}: ${row?.status ?? 'not recorded'} ${(row?.delta ?? []).join('; ')}`.trim()]
  })
  expect(broken).toEqual([])

  const stale = Object.keys(known).filter((key) => status.get(key)?.status === STATUS.same)
  expect(stale).toEqual([])
})
