import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLinePatch, parseFileDiff } from './line-patch'
import { gitRunner } from './cli'
import { gitHardenedEnv } from './git-env'
import { stageLines, unstageLines, discardLines, getFileDiffLines } from './line-staging'

// --- Pure patch construction --------------------------------------------------

const MULTI_ADD = [
  'diff --git a/f.txt b/f.txt',
  'index 1111111..2222222 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,3 +1,6 @@',
  ' a',
  '+add1',
  '+add2',
  '+add3',
  ' b',
  ' c',
  '',
].join('\n')

describe('parseFileDiff', () => {
  test('indexes hunk + body lines with old/new line numbers', () => {
    const { header, lines } = parseFileDiff(MULTI_ADD)
    expect(header).toContain('diff --git a/f.txt b/f.txt')
    expect(header).toContain('+++ b/f.txt')
    // 1 hunk header + 3 context + 3 add
    expect(lines.filter((l) => l.kind === 'hunk')).toHaveLength(1)
    expect(lines.filter((l) => l.kind === 'add')).toHaveLength(3)
    const first = lines.find((l) => l.kind === 'context')!
    expect(first.content).toBe('a')
    expect(first.oldNo).toBe(1)
    expect(first.newNo).toBe(1)
    const add1 = lines.find((l) => l.kind === 'add' && l.content === 'add1')!
    expect(add1.newNo).toBe(2)
    expect(add1.oldNo).toBeUndefined()
    // index is the raw-array position, unique per line
    expect(new Set(lines.map((l) => l.index)).size).toBe(lines.length)
  })
})

describe('buildLinePatch', () => {
  test('selecting one of three additions keeps only that line + recomputes header', () => {
    const { lines } = parseFileDiff(MULTI_ADD)
    const add2 = lines.find((l) => l.content === 'add2')!
    const patch = buildLinePatch(MULTI_ADD, new Set([add2.index]), { reverse: false })!
    expect(patch).not.toBeNull()
    // old side unchanged (3 context lines), new side = 3 context + 1 add = 4
    expect(patch).toContain('@@ -1,3 +1,4 @@')
    expect(patch).toContain('+add2')
    expect(patch).not.toContain('+add1')
    expect(patch).not.toContain('+add3')
    // the unselected additions are dropped (NOT turned into context)
    expect(patch.split('\n').filter((l) => l === '+add1' || l === ' add1')).toHaveLength(0)
  })

  test('no selected change → null', () => {
    // Selecting only a context line yields no change.
    const { lines } = parseFileDiff(MULTI_ADD)
    const ctx = lines.find((l) => l.kind === 'context')!
    expect(buildLinePatch(MULTI_ADD, new Set([ctx.index]), { reverse: false })).toBeNull()
    expect(buildLinePatch(MULTI_ADD, new Set([]), { reverse: false })).toBeNull()
  })

  test('unselected deletion becomes context when a sibling deletion is selected', () => {
    const diff = [
      'diff --git a/f.txt b/f.txt',
      'index 1111111..2222222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,4 +1,2 @@',
      ' a',
      '-del1',
      '-del2',
      ' d',
      '',
    ].join('\n')
    const { lines } = parseFileDiff(diff)
    const del1 = lines.find((l) => l.content === 'del1')!
    const patch = buildLinePatch(diff, new Set([del1.index]), { reverse: false })!
    // del2 is unselected → context; del1 stays a deletion.
    expect(patch).toContain('-del1')
    expect(patch).toContain(' del2')
    // old = 4 (a, del1, del2→ctx, d) ... del1 stays removal so old counts it; new drops del1.
    // old side: context(a) + del(del1) + context(del2) + context(d) = 4
    // new side: a + del2 + d = 3
    expect(patch).toContain('@@ -1,4 +1,3 @@')
  })
})

// --- Real-git round trip (the true correctness guard) -------------------------

describe('line-staging against a real repo', () => {
  let dir: string
  const run = () => gitRunner(dir)

  // A scratch repository: no inherited GIT_* (a hook's GIT_DIR would redirect every call into the
  // developer's repository) and no global or system config.
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: { ...gitHardenedEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      timeout: 10_000,
      killSignal: 'SIGKILL',
    })

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'localix-linestage-'))
    git('init', '-q')
    git('config', 'user.email', 't@t.t')
    git('config', 'user.name', 'T')
    git('config', 'commit.gpgsign', 'false')
    writeFileSync(join(dir, 'f.txt'), 'a\nb\nc\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'init')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('stageLines stages only the selected added line', async () => {
    // Add two new lines; stage only the first of them.
    writeFileSync(join(dir, 'f.txt'), 'a\nADDED1\nADDED2\nb\nc\n')
    const view = await getFileDiffLines(run(), dir, { path: 'f.txt', mode: 'unstaged' })
    const added1 = view.lines.find((l) => l.content === 'ADDED1')!
    expect(added1).toBeTruthy()

    await stageLines(run(), dir, { path: 'f.txt', lines: [added1.index], diffId: view.diffId })

    // The index now contains ADDED1 but NOT ADDED2.
    const staged = git('diff', '--cached')
    expect(staged).toContain('+ADDED1')
    expect(staged).not.toContain('+ADDED2')
    // ADDED2 remains only in the working tree.
    const unstaged = git('diff')
    expect(unstaged).toContain('+ADDED2')
    expect(unstaged).not.toContain('+ADDED1')
  })

  test('unstageLines removes only the selected line from the index', async () => {
    // From the previous test, ADDED1 is staged. Stage everything, then unstage ADDED2.
    git('add', 'f.txt')
    const staged = await getFileDiffLines(run(), dir, { path: 'f.txt', mode: 'staged' })
    const added2 = staged.lines.find((l) => l.content === 'ADDED2')!
    await unstageLines(run(), dir, { path: 'f.txt', lines: [added2.index], diffId: staged.diffId })

    const idx = git('diff', '--cached')
    expect(idx).toContain('+ADDED1')
    expect(idx).not.toContain('+ADDED2')
  })

  test('discardLines reverts only the selected line in the working tree', async () => {
    // Reset to a clean HEAD, make two edits, discard one.
    git('checkout', '-q', '--', 'f.txt')
    git('reset', '-q')
    writeFileSync(join(dir, 'f.txt'), 'a\nX\nY\nc\n') // replaced b with X, and added Y (line c stays)
    const view = await getFileDiffLines(run(), dir, { path: 'f.txt', mode: 'unstaged' })
    const addX = view.lines.find((l) => l.content === 'X')!
    await discardLines(run(), dir, { path: 'f.txt', lines: [addX.index], diffId: view.diffId })

    // X was discarded from the working tree; Y edit remains.
    const content = readFileSync(join(dir, 'f.txt'), 'utf8')
    expect(content).not.toContain('X')
    expect(content).toContain('Y')
  })

  test('a stale diffId is rejected', async () => {
    git('checkout', '-q', '--', 'f.txt')
    git('reset', '-q')
    writeFileSync(join(dir, 'f.txt'), 'a\nZZZ\nb\nc\n')
    const view = await getFileDiffLines(run(), dir, { path: 'f.txt', mode: 'unstaged' })
    const zzz = view.lines.find((l) => l.content === 'ZZZ')!
    expect(
      stageLines(run(), dir, { path: 'f.txt', lines: [zzz.index], diffId: 'deadbeefdeadbeef' }),
    ).rejects.toThrow(/changed since|no longer/i)
  })
})
