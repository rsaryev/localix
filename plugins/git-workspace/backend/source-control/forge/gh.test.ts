import { afterEach, describe, expect, mock, test } from 'bun:test'

// Mock the process layer so tests never spawn a real `gh` and can count calls.
// `gate`, when set, holds every spawn open until released — that is what lets a
// test observe which calls were in flight at the same time.
const calls: string[][] = []
let responder: (args: string[]) => { ok: boolean; stdout: string; notFound: boolean }
let gate: Promise<void> | null = null

await mock.module('./gh-cli', () => ({
  runGh: async (_cwd: string, args: string[]) => {
    calls.push(args)
    if (gate) await gate
    const r = responder(args)
    return { ok: r.ok, stdout: r.stdout, stderr: '', code: r.ok ? 0 : 1, notFound: r.notFound }
  },
}))

const { createGithubForge } = await import('./gh')

const AUTH = ['auth', 'status']
const REPO = ['repo', 'view', '--json', 'nameWithOwner']

const okResponder = (args: string[]) => {
  if (args[0] === 'repo')
    return { ok: true, stdout: JSON.stringify({ nameWithOwner: 'a/b' }), notFound: false }
  return { ok: true, stdout: '', notFound: false }
}

/** Holds spawns open; `release` lets them all finish. */
function holdSpawns(): () => void {
  let release = () => {}
  gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => {
    gate = null
    release()
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  calls.length = 0
  gate = null
})

describe('github forge status probe', () => {
  test('a cold probe runs auth status and repo view at once, with no --version spawn', async () => {
    responder = okResponder
    const release = holdSpawns()
    const forge = createGithubForge()

    const pending = forge.status('/repo')
    await flush()
    // Both are in flight before either has answered: the probe costs the slower
    // call, not the sum. The old chain had only `--version` running here.
    expect(calls).toEqual([AUTH, REPO])

    release()
    expect(await pending).toEqual({
      forge: 'github',
      installed: true,
      authed: true,
      hasRemote: true,
      nameWithOwner: 'a/b',
    })
  })

  test('concurrent callers join one in-flight probe instead of spawning their own', async () => {
    responder = okResponder
    const release = holdSpawns()
    const forge = createGithubForge()

    const burst = [forge.status('/repo'), forge.status('/repo'), forge.status('/repo')]
    await flush()
    release()
    const results = await Promise.all(burst)

    expect(calls).toEqual([AUTH, REPO])
    expect(new Set(results.map((r) => r.nameWithOwner))).toEqual(new Set(['a/b']))
  })

  test('caches auth process-wide and repo view per cwd within the TTL', async () => {
    responder = okResponder
    let t = 1_000
    const forge = createGithubForge({ now: () => t, statusTtlMs: 60_000 })

    await forge.status('/repo-a') // cold: auth status + repo view
    expect(calls).toEqual([AUTH, REPO])
    calls.length = 0

    // Same cwd, still fresh → fully cached, no spawns.
    await forge.status('/repo-a')
    expect(calls.length).toBe(0)

    // New cwd, still fresh → auth reused, only repo view spawns.
    await forge.status('/repo-b')
    expect(calls).toEqual([REPO])
    calls.length = 0

    // Past the TTL → everything re-probed.
    t += 60_001
    await forge.status('/repo-a')
    expect(calls).toEqual([AUTH, REPO])
  })

  test('signed out: the repo answer is hidden, and later cwds skip the repo probe', async () => {
    responder = (args) =>
      args[0] === 'auth' ? { ok: false, stdout: '', notFound: false } : okResponder(args)
    let t = 0
    const forge = createGithubForge({ now: () => t, statusTtlMs: 60_000 })

    expect(await forge.status('/repo-a')).toEqual({
      forge: 'github',
      installed: true,
      authed: false,
      hasRemote: false,
      nameWithOwner: null,
    })
    calls.length = 0

    t += 1_000
    await forge.status('/repo-b')
    expect(calls.length).toBe(0)
  })

  test('prDiff shells `gh pr diff <n>` with the number as its own argv token', async () => {
    responder = (args) =>
      args[0] === 'pr' && args[1] === 'diff'
        ? { ok: true, stdout: 'diff --git a b\n', notFound: false }
        : okResponder(args)
    const forge = createGithubForge()
    const out = await forge.prDiff('/repo', 42)
    expect(out).toBe('diff --git a b\n')
    expect(calls).toEqual([['pr', 'diff', '42']])
  })

  test('prDiff rejects a non-positive / non-integer number before spawning', () => {
    responder = okResponder
    const forge = createGithubForge()
    expect(forge.prDiff('/repo', 0)).rejects.toMatchObject({ code: 'forge_pr_diff_failed' })
    expect(forge.prDiff('/repo', -1)).rejects.toMatchObject({ code: 'forge_pr_diff_failed' })
    expect(forge.prDiff('/repo', 1.5)).rejects.toMatchObject({ code: 'forge_pr_diff_failed' })
    expect(calls.length).toBe(0)
  })

  test('a missing gh binary (spawn ENOENT) reports not installed, cached', async () => {
    responder = () => ({ ok: false, stdout: '', notFound: true })
    let t = 0
    const forge = createGithubForge({
      now: () => t,
      statusTtlMs: 60_000,
      listRemotes: async () => 'origin\tgit@gitlab.com:me/repo.git (fetch)\n',
    })

    expect(await forge.status('/repo')).toEqual({
      forge: 'github',
      installed: false,
      authed: false,
      hasRemote: false,
      nameWithOwner: null,
      githubRemote: false,
    })
    calls.length = 0

    // Within TTL the negative result is reused for any cwd — no re-spawn.
    t += 1_000
    await forge.status('/repo')
    await forge.status('/other')
    expect(calls.length).toBe(0)
  })

  // Without gh the section used to vanish, so a GitHub repo had no PR section and no reason. git's
  // own remotes say whether installing the CLI would help — and only then is it offered.
  test('without gh, a github.com remote is reported so the panel can offer the install', async () => {
    responder = () => ({ ok: false, stdout: '', notFound: true })
    const forge = createGithubForge({
      listRemotes: async () => 'origin\thttps://github.com/me/repo.git (fetch)\n',
    })
    expect((await forge.status('/repo')).githubRemote).toBe(true)
  })
})
