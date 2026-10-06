import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const roots: string[] = []
const script = resolve(import.meta.dir, 'pre-commit.mjs')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function run(root: string, command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    killSignal: 'SIGKILL',
  })
}

function fixture(name: string, content: string) {
  const root = mkdtempSync(join(tmpdir(), 'localix-pre-commit-'))
  roots.push(root)
  expect(run(root, 'git', ['init', '--quiet']).status).toBe(0)
  symlinkSync(resolve(import.meta.dir, '../node_modules'), join(root, 'node_modules'))
  writeFileSync(join(root, name), content)
  expect(run(root, 'git', ['add', '--', name]).status).toBe(0)
  return root
}

test('accepts formatted staged files with spaces and ignores unstaged files', () => {
  const root = fixture('with spaces.json', '{\n  "ok": true\n}\n')
  writeFileSync(join(root, 'unstaged.json'), '{"bad":true}')
  expect(run(root, 'bun', [script]).status).toBe(0)
})

test('blocks unformatted staged content', () => {
  const root = fixture('bad.json', '{"bad":true}')
  expect(run(root, 'bun', [script]).status).not.toBe(0)
})

test('blocks lint errors even when formatting passes', () => {
  const root = fixture('bad.js', 'missing()\n')
  writeFileSync(join(root, '.oxlintrc.json'), JSON.stringify({ rules: { 'no-undef': 'error' } }))
  writeFileSync(join(root, '.oxfmtrc.json'), JSON.stringify({ semi: false }))
  const result = run(root, 'bun', [script])
  expect(result.status).not.toBe(0)
  expect(result.stdout + result.stderr).toContain('no-undef')
})

test('refuses partial staging instead of checking different contents', () => {
  const root = fixture('partial.json', '{"bad":true}')
  writeFileSync(join(root, 'partial.json'), '{\n  "ok": true\n}\n')
  const result = run(root, 'bun', [script])
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Restage:')
})

test('handles a staged deletion without trying to format the missing file', () => {
  const root = fixture('deleted.json', '{"bad":true}')
  expect(
    run(root, 'git', [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ]).status,
  ).toBe(0)
  expect(run(root, 'git', ['rm', '--', 'deleted.json']).status).toBe(0)
  expect(run(root, 'bun', [script]).status).toBe(0)
})
