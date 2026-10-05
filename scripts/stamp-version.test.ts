import { afterEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertConsistent, readVersions, repoRootFromHere, stampVersion } from './stamp-version.mjs'

const real = repoRootFromHere()
const srcTauri = ['apps', 'desktop-tauri', 'src-tauri']
const roots: string[] = []

/** A copy of the three real files, so each test edits a throwaway tree. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'stamp-version-'))
  roots.push(root)
  mkdirSync(join(root, ...srcTauri), { recursive: true })
  for (const file of ['tauri.conf.json', 'Cargo.toml', 'Cargo.lock']) {
    cpSync(join(real, ...srcTauri, file), join(root, ...srcTauri, file))
  }
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('the committed desktop version', () => {
  test('is the same in tauri.conf.json, Cargo.toml and Cargo.lock', () => {
    expect(() => assertConsistent(real)).not.toThrow()
  })
})

describe('stampVersion', () => {
  test('rewrites all three files and nothing else', () => {
    const root = fixture()
    const before = ['tauri.conf.json', 'Cargo.toml', 'Cargo.lock'].map((file) =>
      readFileSync(join(root, ...srcTauri, file), 'utf8'),
    )
    stampVersion(root, '1.2.3-beta.4')
    expect(readVersions(root)).toEqual({
      'tauri.conf.json': '1.2.3-beta.4',
      'Cargo.toml': '1.2.3-beta.4',
      'Cargo.lock': '1.2.3-beta.4',
    })
    const after = ['tauri.conf.json', 'Cargo.toml', 'Cargo.lock'].map((file) =>
      readFileSync(join(root, ...srcTauri, file), 'utf8'),
    )
    // One line differs per file: formatting and every other dependency version are untouched.
    for (const [index, text] of after.entries()) {
      const changed = text.split('\n').filter((line, at) => line !== before[index]!.split('\n')[at])
      expect(changed).toHaveLength(1)
    }
  })

  test('refuses a version that is not semantic, and writes nothing', () => {
    const root = fixture()
    const before = readFileSync(join(root, ...srcTauri, 'Cargo.toml'), 'utf8')
    for (const bad of ['', 'v1.2.3', '1.2', '1.2.3-', '1.2.3 beta', '1.2.3\n"; rm -rf /']) {
      expect(() => stampVersion(root, bad)).toThrow('Not a semantic version')
    }
    expect(readFileSync(join(root, ...srcTauri, 'Cargo.toml'), 'utf8')).toBe(before)
  })

  test('writes nothing when one file has no version to stamp', () => {
    const root = fixture()
    const lock = join(root, ...srcTauri, 'Cargo.lock')
    writeFileSync(lock, '# empty lockfile\n')
    const conf = readFileSync(join(root, ...srcTauri, 'tauri.conf.json'), 'utf8')
    expect(() => stampVersion(root, '2.0.0')).toThrow('Cargo.lock: no version found')
    expect(readFileSync(join(root, ...srcTauri, 'tauri.conf.json'), 'utf8')).toBe(conf)
  })

  test('does not touch another crate that happens to share the version', () => {
    const root = fixture()
    const lock = join(root, ...srcTauri, 'Cargo.lock')
    const text = readFileSync(lock, 'utf8')
    stampVersion(root, '9.9.9')
    const stamped = readFileSync(lock, 'utf8')
    expect(stamped.match(/version = "9\.9\.9"/gu)).toHaveLength(1)
    expect(text.split('\n').length).toBe(stamped.split('\n').length)
  })
})

describe('assertConsistent', () => {
  test('names every file when the versions differ', () => {
    const root = fixture()
    const toml = join(root, ...srcTauri, 'Cargo.toml')
    writeFileSync(
      toml,
      readFileSync(toml, 'utf8').replace(/^version = ".*"/mu, 'version = "0.0.2"'),
    )
    expect(() => assertConsistent(root)).toThrow(
      /tauri\.conf\.json: 0\.0\.1[\s\S]*Cargo\.toml: 0\.0\.2[\s\S]*Cargo\.lock: 0\.0\.1/u,
    )
  })
})
