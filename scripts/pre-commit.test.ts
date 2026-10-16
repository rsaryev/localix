import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { planChecks } from './pre-commit-plan.mjs'

const roots: string[] = []
const script = resolve(import.meta.dir, 'pre-commit.mjs')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function run(root: string, command: string, args: string[], env = process.env) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    killSignal: 'SIGKILL',
    env,
  })
}

function fixture(name: string, content: string) {
  const root = mkdtempSync(join(tmpdir(), 'localix-pre-commit-'))
  roots.push(root)
  expect(run(root, 'git', ['init', '--quiet']).status).toBe(0)
  symlinkSync(resolve(import.meta.dir, '../node_modules'), join(root, 'node_modules'))
  mkdirSync(dirname(join(root, name)), { recursive: true })
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

const workspaces = [
  { path: 'packages/shared', name: 'shared', dependencies: [], scripts: { 'type-check': 'tsc' } },
  {
    path: 'apps/api',
    name: 'api',
    dependencies: ['shared'],
    scripts: { 'type-check': 'tsc', 'type-check:tests': 'tsc' },
  },
  { path: 'apps/ui', name: 'ui', dependencies: ['api'], scripts: { 'type-check': 'tsc' } },
  { path: 'plugins/example', name: 'example', dependencies: [], scripts: { 'type-check': 'tsc' } },
]

test('checks deleted sources and every transitive consumer of a shared contract', () => {
  const plan = planChecks(['packages/shared/src/removed.ts'], workspaces, () => false)
  expect(plan.typed.map((workspace) => workspace.name)).toEqual(['shared', 'api', 'ui'])
  const api = planChecks(['apps/api/src/changed.ts'], workspaces, () => false)
  expect(api.typed.map((workspace) => workspace.name)).toEqual(['api', 'ui'])
  expect(api.affected.map((workspace) => workspace.name)).toEqual(['shared', 'api', 'ui'])
})

test('includes API consumers for plugin backends and all packages for shared compiler changes', () => {
  expect(
    planChecks(['plugins/example/backend/index.ts'], workspaces, () => false).typed.map(
      (workspace) => workspace.name,
    ),
  ).toEqual(['api', 'ui', 'example'])
  expect(planChecks(['tsconfig.base.json'], workspaces, () => false).typed).toEqual(workspaces)
  expect(planChecks(['docs/guide.md'], workspaces, () => false).typed).toEqual([])
})

test('selects existing sibling tests and Rust source or dependency changes', () => {
  const existing = new Set(['apps/api/src/topic.test.ts', 'apps/api/src/topic.dom.test.tsx'])
  const plan = planChecks(['apps/api/src/topic.ts'], workspaces, (path) => existing.has(path))
  expect(plan.tests).toEqual([...existing])
  for (const file of ['lib.rs', 'Cargo.toml', 'Cargo.lock', 'tauri.conf.json']) {
    expect(planChecks([`apps/desktop-tauri/src-tauri/${file}`], [], () => false).rust).toBe(true)
  }
  expect(planChecks(['docs/rust.md'], [], () => false).rust).toBe(false)
})

function typedFixture(content: string) {
  const root = fixture('apps/api/src/bad.test.ts', content)
  writeFileSync(join(root, '.oxfmtrc.json'), JSON.stringify({ semi: false }))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ workspaces: ['apps/*'], packageManager: 'bun@1.3.14' }),
  )
  writeFileSync(
    join(root, 'apps/api/package.json'),
    JSON.stringify({ name: 'api', scripts: { 'type-check:tests': 'tsc' } }),
  )
  writeFileSync(
    join(root, 'apps/api/tsconfig.test.json'),
    JSON.stringify({
      compilerOptions: { strict: true, types: [], skipLibCheck: true },
      include: ['src'],
    }),
  )
  rmSync(join(root, 'node_modules'))
  const bin = join(root, 'node_modules/.bin')
  mkdirSync(bin, { recursive: true })
  for (const tool of ['oxfmt', 'oxlint']) {
    symlinkSync(resolve(import.meta.dir, '../node_modules/.bin', tool), join(bin, tool))
  }
  // Keep the fixture independent of repository builds while exercising the real TS compiler.
  writeFileSync(
    join(bin, 'turbo'),
    `#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
writeFileSync('turbo-args.json', JSON.stringify(process.argv.slice(2)))
const result = spawnSync(${JSON.stringify(resolve(import.meta.dir, '../node_modules/.bin/tsc'))},
  ['--noEmit', '-p', 'apps/api/tsconfig.test.json'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
`,
    { mode: 0o755 },
  )
  expect(run(root, join(bin, 'oxfmt'), ['--write', 'apps/api/src/bad.test.ts']).status).toBe(0)
  expect(run(root, 'git', ['add', 'apps/api/src/bad.test.ts']).status).toBe(0)
  return root
}

test('blocks test fixture type errors even when formatting and lint pass', () => {
  const root = typedFixture("type Item = { status: 'completed' }\nexport const item: Item = {}\n")
  const result = run(root, 'bun', [script])
  expect(result.status).toBe(1)
  expect(result.stdout + result.stderr).toContain("Property 'status' is missing")
  expect(JSON.parse(readFileSync(join(root, 'turbo-args.json'), 'utf8'))).toEqual([
    'type-check',
    'type-check:tests',
    '--concurrency=2',
    '--filter=api',
  ])
})

test('blocks an unstaged repair in a package whose types are being checked', () => {
  const root = typedFixture("export const value: string = 'ok'\n")
  writeFileSync(join(root, 'apps/api/src/other.ts'), 'export const value: string = 1\n')
  expect(run(root, 'git', ['add', 'apps/api/src/other.ts']).status).toBe(0)
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
      'baseline',
    ]).status,
  ).toBe(0)
  writeFileSync(join(root, 'apps/api/src/bad.test.ts'), "export const value: string = 'changed'\n")
  expect(run(root, 'git', ['add', 'apps/api/src/bad.test.ts']).status).toBe(0)
  writeFileSync(join(root, 'apps/api/src/other.ts'), "export const value: string = 'fixed'\n")
  const result = run(root, 'bun', [script])
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Restage:')
})

test('blocks a failing staged test even when formatting and lint pass', () => {
  const root = fixture('failure.test.ts', "throw new Error('fixture regression')\n")
  writeFileSync(join(root, '.oxfmtrc.json'), JSON.stringify({ semi: false }))
  expect(
    run(root, join(root, 'node_modules/.bin/oxfmt'), ['--write', 'failure.test.ts']).status,
  ).toBe(0)
  expect(run(root, 'git', ['add', 'failure.test.ts']).status).toBe(0)
  const result = run(root, 'bun', [script])
  expect(result.status).not.toBe(0)
  expect(result.stdout + result.stderr).toContain('fixture regression')
})

test('Rust lint-only mode propagates Clippy failures and never runs the Rust test suite', () => {
  const root = fixture('placeholder.json', '{}\n')
  const scripts = join(root, 'apps/desktop-tauri/scripts')
  const bin = join(root, 'bin')
  mkdirSync(scripts, { recursive: true })
  mkdirSync(bin)
  for (const name of ['check-rust.mjs', 'tauri-staging.mjs']) {
    copyFileSync(
      resolve(import.meta.dir, '../apps/desktop-tauri/scripts', name),
      join(scripts, name),
    )
  }
  writeFileSync(join(bin, 'rustc'), '#!/bin/sh\necho "host: x86_64-unknown-linux-gnu"\n', {
    mode: 0o755,
  })
  writeFileSync(
    join(bin, 'cargo'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$LOCALIX_TEST_CARGO_LOG"\n' +
      'if [ "$1" = clippy ] && [ "$2" != --version ]; then exit "$LOCALIX_TEST_CLIPPY_EXIT"; fi\n',
    { mode: 0o755 },
  )
  const log = join(root, 'cargo.log')
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LOCALIX_TEST_CARGO_LOG: log,
    LOCALIX_TEST_CLIPPY_EXIT: '0',
  }
  expect(run(root, 'bun', [join(scripts, 'check-rust.mjs'), '--lint-only'], env).status).toBe(0)
  const commands = readFileSync(log, 'utf8')
  expect(commands).toContain('fmt --all -- --check')
  expect(commands).toContain('clippy --all-targets --locked --quiet -- -D warnings')
  expect(commands).toContain('clippy --locked --quiet -- -D warnings')
  expect(commands).not.toMatch(/^test /mu)
  expect(
    run(root, 'bun', [join(scripts, 'check-rust.mjs'), '--lint-only'], {
      ...env,
      LOCALIX_TEST_CLIPPY_EXIT: '101',
    }).status,
  ).toBe(101)
})
