import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installStaplerShim } from './apple-staple-shim.mjs'

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/**
 * A stand-in for Apple's `xcrun`: it logs each call, and `stapler staple` fails (exit 68, the
 * dropped CloudKit connection) for the first `stapleFailures` calls.
 */
function fakeXcrun(stapleFailures: number) {
  dir = mkdtempSync(join(tmpdir(), 'localix-staple-shim-'))
  const log = join(dir, 'calls.log')
  const count = join(dir, 'staple-count')
  writeFileSync(count, '0')
  const real = join(dir, 'real-xcrun')
  writeFileSync(
    real,
    `#!/bin/sh
echo "$*" >> '${log}'
if [ "$1" = stapler ] && [ "$2" = staple ]; then
  n=$(($(cat '${count}') + 1)); echo "$n" > '${count}'
  [ "$n" -le ${stapleFailures} ] && exit 68
fi
[ "$1" = notarytool ] && exit 3
exit 0
`,
  )
  chmodSync(real, 0o755)
  const shim = installStaplerShim(join(dir, 'bin'), { realXcrun: real, waitSeconds: 0 })
  const xcrun = (...args: string[]) =>
    spawnSync(join(shim, 'xcrun'), args, { encoding: 'utf8', timeout: 10_000 })
  const calls = () => readFileSync(log, 'utf8').trim().split('\n')
  return { xcrun, calls }
}

describe('the xcrun Tauri staples the app with during a release build', () => {
  // Tauri staples the .app once and then packs it into the DMG whatever stapler said, so a dropped
  // connection to Apple shipped an app without its ticket (v0.1.0-beta.25's first build).
  test('asks Apple again until the ticket is on the app, and checks it is there', () => {
    const { xcrun, calls } = fakeXcrun(2)
    const result = xcrun('stapler', 'staple', '-v', 'Localix.app')
    expect(result.status).toBe(0)
    expect(calls()).toEqual([
      'stapler staple -v Localix.app',
      'stapler staple -v Localix.app',
      'stapler staple -v Localix.app',
      'stapler validate Localix.app',
    ])
  })

  test('fails when Apple never answers, instead of reporting a ticket that is not there', () => {
    const { xcrun, calls } = fakeXcrun(99)
    expect(xcrun('stapler', 'staple', '-v', 'Localix.app').status).not.toBe(0)
    expect(calls()).toHaveLength(4)
  })

  test('hands every other call to the real xcrun unchanged, with its exit code', () => {
    const { xcrun, calls } = fakeXcrun(0)
    expect(xcrun('notarytool', 'submit', 'a b.dmg', '--wait').status).toBe(3)
    expect(calls()).toEqual(['notarytool submit a b.dmg --wait'])
  })
})
