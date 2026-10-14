import { describe, expect, test } from 'bun:test'
import { buildLogArgs, getHeadCommitMessage, getRecentCommitMessages, parseCommitRefs } from './log'
import type { GitResult, GitRunner } from './cli'

const ok = (stdout: string): GitResult => ({ ok: true, stdout, stderr: '', code: 0 })
const fail = (): GitResult => ({ ok: false, stdout: '', stderr: 'fatal', code: 128 })

const runner =
  (result: GitResult): GitRunner =>
  async () =>
    result

describe('getHeadCommitMessage', () => {
  test('strips our Co-Authored-By trailer so re-amending starts clean', async () => {
    const raw =
      'feat: add login\n\nA longer body.\n\nCo-Authored-By: Localix <noreply@localix.ai>\n'
    expect(await getHeadCommitMessage(runner(ok(raw)))).toBe('feat: add login\n\nA longer body.')
  })

  test('keeps a message that has no trailer (and trims trailing newlines)', async () => {
    expect(await getHeadCommitMessage(runner(ok('chore: tidy\n')))).toBe('chore: tidy')
  })

  test('keeps a foreign co-author trailer intact', async () => {
    const raw = 'fix: x\n\nCo-Authored-By: Other <other@example.com>'
    expect(await getHeadCommitMessage(runner(ok(raw)))).toBe(raw)
  })

  test('returns null on an unborn branch (git log fails)', async () => {
    expect(await getHeadCommitMessage(runner(fail()))).toBeNull()
  })

  test('returns null for an empty message', async () => {
    expect(await getHeadCommitMessage(runner(ok('\n\n')))).toBeNull()
  })
})

describe('getRecentCommitMessages', () => {
  const RS = '\x1e'

  test('splits records, strips our trailer, keeps bodies (newest first)', async () => {
    const raw =
      `feat: b\n\nBody two.\n\nCo-Authored-By: Localix <noreply@localix.ai>\n${RS}` +
      `chore: a\n${RS}`
    expect(await getRecentCommitMessages(runner(ok(raw)), 20)).toEqual([
      'feat: b\n\nBody two.',
      'chore: a',
    ])
  })

  test('collapses consecutive duplicate messages', async () => {
    const raw = `fix: x\n${RS}fix: x\n${RS}feat: y\n${RS}`
    expect(await getRecentCommitMessages(runner(ok(raw)), 20)).toEqual(['fix: x', 'feat: y'])
  })

  test('drops empty records', async () => {
    const raw = `a\n${RS}\n${RS}b\n${RS}`
    expect(await getRecentCommitMessages(runner(ok(raw)), 20)).toEqual(['a', 'b'])
  })

  test('returns [] on an unborn branch (git log fails)', async () => {
    expect(await getRecentCommitMessages(runner(fail()), 20)).toEqual([])
  })
})

describe('buildLogArgs (filter → git log args)', () => {
  test('no filter → plain log args', () => {
    const args = buildLogArgs(30)
    expect(args.slice(0, 3)).toEqual(['log', '-n', '30'])
    expect(args).not.toContain('-i')
    expect(args.some((a) => a.startsWith('--grep'))).toBe(false)
    expect(args.some((a) => a.startsWith('--author'))).toBe(false)
    expect(args).not.toContain('--')
  })

  test('message query maps to a single --grep=<value> token (never a bare flag) + case-insensitive', () => {
    const args = buildLogArgs(20, { query: 'fix bug' })
    expect(args).toContain('-i')
    expect(args).toContain('--grep=fix bug')
    // The value is fused into the flag token, so it can NEVER be read as an arg.
    expect(args).not.toContain('fix bug')
  })

  test('author maps to --author=<value>', () => {
    expect(buildLogArgs(20, { author: 'ada@example.com' })).toContain('--author=ada@example.com')
  })

  test('a leading-dash value stays fused to its flag (no injection)', () => {
    const args = buildLogArgs(20, { query: '--upload-pack=evil' })
    expect(args).toContain('--grep=--upload-pack=evil')
    expect(args).not.toContain('--upload-pack=evil')
  })

  test('path becomes a trailing pathspec after -- (git requires it last)', () => {
    const args = buildLogArgs(20, { path: 'src/app.ts' })
    const sepAt = args.indexOf('--')
    expect(sepAt).toBeGreaterThan(-1)
    expect(args[sepAt + 1]).toBe('src/app.ts')
    expect(sepAt).toBe(args.length - 2) // -- and the path are the final two tokens
  })

  test('all three filters combine (message, author, path) — path last', () => {
    const args = buildLogArgs(10, { query: 'feat', author: 'ada', path: 'a/b.ts' })
    expect(args).toContain('--grep=feat')
    expect(args).toContain('--author=ada')
    expect(args.slice(-2)).toEqual(['--', 'a/b.ts'])
  })

  test('blank / whitespace-only values are dropped (empty search = normal log)', () => {
    const args = buildLogArgs(10, { query: '   ', author: '', path: '  ' })
    expect(args).not.toContain('-i')
    expect(args.some((a) => a.startsWith('--grep'))).toBe(false)
    expect(args).not.toContain('--')
  })

  test('requests full ref decorations for unambiguous branch/remote/tag parsing', () => {
    expect(buildLogArgs(30)).toContain('--decorate=full')
  })
})

describe('parseCommitRefs (%D decoration → display refs)', () => {
  test('empty / whitespace decoration → no refs', () => {
    expect(parseCommitRefs('')).toEqual([])
    expect(parseCommitRefs('   ')).toEqual([])
  })

  test('HEAD -> branch marks the branch current and floats it first', () => {
    const refs = parseCommitRefs(
      'HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0',
    )
    expect(refs).toEqual([
      { kind: 'branch', name: 'main', current: true },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1.0' },
    ])
  })

  test('bare HEAD (detached) becomes a head marker', () => {
    expect(parseCommitRefs('HEAD, tag: refs/tags/v2')).toEqual([
      { kind: 'head', name: 'HEAD' },
      { kind: 'tag', name: 'v2' },
    ])
  })

  test('a local branch with a slash is not mistaken for a remote (full-ref form)', () => {
    expect(parseCommitRefs('refs/heads/feature/foo')).toEqual([
      { kind: 'branch', name: 'feature/foo' },
    ])
  })

  test('symbolic remote HEAD (origin/HEAD) is dropped as noise', () => {
    expect(parseCommitRefs('refs/remotes/origin/HEAD, refs/remotes/origin/main')).toEqual([
      { kind: 'remote', name: 'origin/main' },
    ])
  })

  test('short-form fallback: slash → remote, bare name → branch', () => {
    expect(parseCommitRefs('main, origin/main, tag: v3')).toEqual([
      { kind: 'branch', name: 'main' },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v3' },
    ])
  })

  test('multiple local branches at one commit all surface, current first', () => {
    const refs = parseCommitRefs('refs/heads/topic, HEAD -> refs/heads/main')
    expect(refs).toEqual([
      { kind: 'branch', name: 'main', current: true },
      { kind: 'branch', name: 'topic' },
    ])
  })

  test('bisect pseudo-refs (refs/bisect/*) are dropped, not shown as fake remotes', () => {
    expect(parseCommitRefs('refs/bisect/bad')).toEqual([])
    expect(parseCommitRefs('HEAD -> refs/heads/main, refs/bisect/good-abc123')).toEqual([
      { kind: 'branch', name: 'main', current: true },
    ])
  })
})
