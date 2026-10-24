#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { repoRoot } from '../lib/paths.mjs'
import { interactiveSession, printRun } from './lib/claude.mjs'
import { diffSnapshots, diffSurfaces, formatParity, parity } from './lib/compare.mjs'
import {
  claudeVersion,
  LOCALIX_SNAPSHOT,
  probeCopy,
  snapshotPath,
  surfacePath,
  versionCache,
} from './lib/paths.mjs'
import { mergeRecordings, parityInputs, writeJson } from './lib/recording.mjs'
import { surfaceOf } from './lib/surface.mjs'

/**
 * The Claude Code parity tool (README.md). Subcommands:
 *   types [--cwd <dir>]   the installed Claude Code's mod type declarations, into the cache
 *   observe --allow-model two small `claude -p` runs with the probe; the committed snapshot
 *   diff <a> <b>          what changed between two committed Claude Code versions
 *   localix               the probe in Localix's mod host; snapshots/localix.json and the report
 */

const [command, ...rest] = process.argv.slice(2)
const option = (name, fallback) => {
  const at = rest.indexOf(name)
  return at >= 0 && rest[at + 1] ? rest[at + 1] : fallback
}
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const cachedTypes = (version) => join(versionCache(version), 'types', 'claude-code', 'index.d.ts')

async function types() {
  const version = claudeVersion()
  const cache = versionCache(version)
  mkdirSync(cache, { recursive: true })
  const probe = probeCopy('types')
  const cwd = option('--cwd', repoRoot())
  const record = join(cache, 'interactive.json')
  rmSync(record, { force: true })
  console.log(`Claude Code ${version}: loading the probe in an interactive session in ${cwd}.`)
  console.log('No prompt is sent and no model is asked.')
  const timeoutMs = Number(option('--timeout', '60')) * 1000
  await interactiveSession({ probe, cwd, record, timeoutMs })
  const target = join(cache, 'types')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(join(probe, '.claude-plugin', 'types'), target, { recursive: true })
  console.log(
    `types: ${cachedTypes(version)} (Claude Code's own file: gitignored, never commit it)`,
  )
  console.log(`interactive observations: ${record}`)
}

const WRITE_PROMPT =
  'Use the Write tool to create a file named note.txt containing the single word ok. ' +
  'Then reply with one short line.'

async function observe() {
  const version = claudeVersion()
  if (!rest.includes('--allow-model')) {
    console.error(
      'observe runs `claude -p` twice (one `/probe`, one tiny turn on haiku) and three tiny ' +
        '$.model calls. That spends your own Claude Code usage. Run again with --allow-model.',
    )
    process.exit(2)
  }
  if (!existsSync(cachedTypes(version))) {
    console.error(`No type declarations cached for ${version}: run \`types\` first.`)
    process.exit(1)
  }
  console.log(`Claude Code ${version}: this run spends your own Claude Code usage (haiku).`)
  const cache = versionCache(version)
  const record = join(cache, 'print.json')
  rmSync(record, { force: true })
  const probe = probeCopy('observe')
  const cwd = mkdtempSync(join(tmpdir(), 'cc-parity-'))
  for (const prompt of ['/probe', WRITE_PROMPT]) {
    const run = printRun({ probe, cwd, record, prompt, allowModelCalls: true })
    console.log(`claude -p ${JSON.stringify(prompt.slice(0, 40))}… exited ${run.status}`)
    if (run.status !== 0) console.error(run.stderr.slice(-2000))
  }
  rmSync(cwd, { recursive: true, force: true })
  const runs = ['interactive.json', 'print.json']
    .map((file) => join(cache, file))
    .filter(existsSync)
  const snapshot = {
    source: 'claude-code',
    version,
    note: 'Shape descriptors observed by scripts/cc-parity/probe; names and kinds only.',
    entries: mergeRecordings(runs.map(readJson)),
  }
  writeJson(snapshotPath(version), snapshot)
  writeJson(surfacePath(version), {
    source: 'claude-code',
    version,
    note: 'Identifiers extracted by scripts/cc-parity/lib/surface.mjs; names only.',
    ...surfaceOf(readFileSync(cachedTypes(version), 'utf8')),
  })
  console.log(`${snapshot.entries.length} entries: ${snapshotPath(version)}`)
  console.log(`surface: ${surfacePath(version)}`)
}

function diff() {
  const [a, b] = rest
  if (!a || !b) {
    console.error('usage: diff <older version> <newer version>, e.g. diff 2.1.310 2.1.320')
    process.exit(2)
  }
  const changes = diffSnapshots(readJson(snapshotPath(a)), readJson(snapshotPath(b)))
  console.log(`Claude Code ${a} → ${b}: observed shapes`)
  for (const key of changes.added) console.log(`+ ${key}`)
  for (const key of changes.removed) console.log(`- ${key}`)
  for (const { key, delta } of changes.changed) {
    console.log(`~ ${key}`)
    for (const line of delta) console.log(`    ${line}`)
  }
  if (existsSync(surfacePath(a)) && existsSync(surfacePath(b))) {
    console.log(`\nClaude Code ${a} → ${b}: declared surface`)
    for (const line of diffSurfaces(readJson(surfacePath(a)), readJson(surfacePath(b))))
      console.log(line)
  }
}

async function localix() {
  const { observeLocalix } = await import('./localix/drive.ts')
  const dir = mkdtempSync(join(tmpdir(), 'cc-parity-localix-'))
  const recording = await observeLocalix(dir)
  rmSync(dir, { recursive: true, force: true })
  writeJson(LOCALIX_SNAPSHOT, {
    source: 'localix',
    note: 'Shape descriptors the probe recorded in Localix’s mods host (scripts/cc-parity/localix).',
    entries: recording.entries,
  })
  const { version, claude, checked, known } = parityInputs()
  console.log(`wrote ${LOCALIX_SNAPSHOT}\nagainst Claude Code ${version}:\n`)
  for (const line of formatParity(parity(claude, recording, { known }), { checked }))
    console.log(line)
}

const commands = { types, observe, diff, localix }

if (import.meta.main) {
  if (!commands[command]) {
    console.error(
      'usage: bun scripts/cc-parity/run.mjs <types|observe --allow-model|diff a b|localix>',
    )
    process.exit(2)
  }
  await commands[command]()
  // The Localix host's VM workers would keep the process alive.
  process.exit(0)
}
