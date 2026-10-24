import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { repoRoot } from '../../lib/paths.mjs'
import { run } from '../../lib/run.mjs'
import { byText, mergeShape } from '../probe/hooks/shape.js'
import { claudeSnapshots, snapshotPath, TOOL_DIR } from './paths.mjs'

/** Recordings of several runs as one list of entries, a name's shapes merged, sorted by key. */
export function mergeRecordings(recordings) {
  const entries = new Map()
  for (const recording of recordings)
    for (const entry of recording?.entries ?? []) {
      const key = `${entry.kind}:${entry.name}`
      const known = entries.get(key)
      entries.set(key, known ? { ...known, shape: mergeShape(known.shape, entry.shape) } : entry)
    }
  return [...entries.keys()].sort(byText).map((key) => entries.get(key))
}

/** A committed JSON file, formatted as the repository formats it (Oxfmt), so a rerun diffs clean. */
export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
  const oxfmt = join(repoRoot(), 'node_modules', '.bin', 'oxfmt')
  if (existsSync(oxfmt)) run(oxfmt, ['--write', file])
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** The newest committed Claude Code snapshot, and the entries checked and the gaps known. */
export function parityInputs() {
  const [version] = claudeSnapshots()
  if (!version) throw new Error('no committed Claude Code snapshot: run `observe` first')
  return {
    version,
    claude: readJson(snapshotPath(version)),
    checked: readJson(join(TOOL_DIR, 'checked.json')).checked,
    known: readJson(join(TOOL_DIR, 'known-gaps.json')).gaps,
  }
}
