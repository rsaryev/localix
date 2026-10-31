/**
 * Every child process the API starts says `windowsHide`.
 *
 * On Windows a console-subsystem child (bun, git, tar, bash, where, powershell) spawned by a
 * windowless parent gets a NEW console window unless it is told to hide. The detached CLI
 * daemon flashed one on every `localix` start, and plugin git clones, tarball extraction,
 * `where` lookups and hook commands each flashed their own. No behaviour test observes a
 * window, so the rule is read off the source: a spawn call whose argument list does not
 * name `windowsHide` is the defect. POSIX-only call sites carry it too — one rule with no
 * platform reasoning per call is the version that stays true.
 *
 * The honest-lint mechanics (comment stripping, recursive walk, liveness floor, planted
 * positive control) live once in `source-lint.ts`; this file supplies only the detector.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { dirname } from 'node:path'

import {
  assertNotVoid,
  assertPositiveControl,
  auditExemptions,
  exemptionKey,
  scanSources,
  staleReport,
  type Exemptions,
} from './source-lint'

// Walks the whole source tree: seconds under a parallel run of every package, not milliseconds.
setDefaultTimeout(30_000)

const SRC = dirname(dirname(Bun.fileURLToPath(import.meta.url)))

const CHILD_PROCESS_FNS = new Set([
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
])

/** The callee names a file can reach child_process through: imports, aliases, promisify. */
function spawnCallees(code: string): string[] {
  const names = new Set<string>()
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
    for (const part of m[1]!.split(',')) {
      const [name, alias] = part
        .replace(/\btype\s+/, '')
        .trim()
        .split(/\s+as\s+/)
      if (name && CHILD_PROCESS_FNS.has(name)) names.add((alias ?? name).trim())
    }
  }
  for (const m of code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*promisify\(\s*(\w+)\s*\)/g)) {
    if (names.has(m[2]!)) names.add(m[1]!)
  }
  return [...names]
}

/** The text between a call's parentheses, balanced. */
function callArgs(code: string, open: number): string {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')' && --depth === 0) return code.slice(open + 1, i)
  }
  return code.slice(open + 1)
}

interface SpawnCall {
  key: string
  hidden: boolean
}

function spawnCalls(file: string, code: string): SpawnCall[] {
  const callees = spawnCallees(code).map((n) => `(?<![\\w.])${n}`)
  const patterns = [...callees, '\\b[Bb]un\\.spawn(?:Sync)?']
  const calls: SpawnCall[] = []
  for (const m of code.matchAll(new RegExp(`(?:${patterns.join('|')})\\s*\\(`, 'g'))) {
    const before = code.slice(Math.max(0, m.index - 20), m.index)
    if (/function\s+$/.test(before)) continue
    const args = callArgs(code, m.index + m[0].length - 1)
    const callee = m[0].replace(/\s*\($/, '')
    const firstArg = args.trim().split(/[,\n]/)[0]!.trim().slice(0, 40)
    calls.push({
      key: exemptionKey(file, callee, firstArg),
      hidden: /\bwindowsHide\b/.test(args),
    })
  }
  return calls
}

async function scan(root: string, minFiles: number): Promise<SpawnCall[]> {
  const sources = await scanSources({
    root,
    include: ['**/*.ts'],
    skip: (f) => f.endsWith('.test.ts'),
    minFiles,
  })
  return sources.flatMap((s) => spawnCalls(s.file, s.code))
}

/** Spawns that need no `windowsHide`, each with why. */
const EXEMPT: Exemptions = {
  [exemptionKey('features/terminal/pty-bun.ts', 'Bun.spawn', 'ptyArgv(options)')]: {
    reason: 'A PTY: a ConPTY child has no console window of its own to hide.',
  },
}

describe('every spawn hides its Windows console', () => {
  test('no call site omits windowsHide', async () => {
    const calls = await scan(SRC, 200)
    assertNotVoid('child-process spawn call', calls.length, 'Did the callee detector drift?')
    const { offenders, stale } = auditExemptions(
      EXEMPT,
      calls.filter((c) => !c.hidden).map((c) => c.key),
    )
    expect(offenders).toEqual([])
    if (stale.length) throw new Error(staleReport(stale))
  })

  test('positive control — the daemon spawn without windowsHide fires', async () => {
    await assertPositiveControl({
      subject: 'a detached spawn with no windowsHide',
      file: 'daemon/nested/spawn-daemon.ts',
      offender: [
        "import { spawn as launch } from 'node:child_process'",
        "launch(process.execPath, ['server.js'], { detached: true, stdio: 'ignore' })",
      ].join('\n'),
      detect: async (root) => (await scan(root, 1)).filter((c) => !c.hidden).map((c) => c.key),
      scaffold: {
        'clean.ts': [
          "import { execFile } from 'node:child_process'",
          "import { promisify } from 'node:util'",
          'const run = promisify(execFile)',
          "await run('git', ['status'], { windowsHide: true })",
          "Bun.spawn(['bun'], { windowsHide: true })",
          'const r = /x/.exec(text)',
        ].join('\n'),
      },
    })
  })

  test('promisified aliases and Bun.spawn are seen', () => {
    const code = [
      "import { execFile } from 'node:child_process'",
      'const run = promisify(execFile)',
      "await run('tar', ['-x'])",
      "Bun.spawn(['bun'])",
      'lease.exec("BEGIN")',
    ].join('\n')
    expect(spawnCalls('x.ts', code).map((c) => c.key)).toEqual([
      "x.ts::run::'tar'",
      "x.ts::Bun.spawn::['bun']",
    ])
  })
})
