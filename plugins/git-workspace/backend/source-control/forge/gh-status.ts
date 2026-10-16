/**
 * The GitHub forge availability probe behind `/forge/status`.
 *
 * The defect it stops: a cold probe ran `gh --version`, then `gh auth status` (a network
 * round-trip), then `gh repo view` (another) strictly one after another — 3.9 s on a packaged first
 * launch — and every caller that arrived while that chain ran (the startup burst, the remount a
 * branch change causes) started its own copy, because the cache filled only once a probe had
 * finished. Three facts shape the fix:
 *
 * - `--version` answered one question — is the binary on PATH — that every spawn already answers:
 *   a missing `gh` is the spawn's ENOENT (`notFound`). `auth status` carries it, so `--version` is
 *   gone and a missing binary is still reported as `installed: false`.
 * - `auth status` and `repo view` do not depend on each other, so a cold probe runs them
 *   concurrently and costs the slower of the two instead of their sum. The flags are then combined
 *   exactly as before: no binary or no login hides the repo answer.
 * - The cache stores the in-flight PROMISE, stamped when it started. A caller inside the TTL joins
 *   the probe that is running (single-flight) or reuses the one that settled. Authentication is
 *   cwd-independent, so it is one process-wide entry; repository identity is keyed by the repo
 *   root the service resolved.
 *
 * Nothing invalidates an entry before its TTL: the backend has no git-change signal and no route
 * here adds or removes a remote, so the TTL alone bounds how long a just-installed or just-signed-in
 * `gh` goes unnoticed.
 */
import type { ForgeStatus } from './contracts'
import { parseNameWithOwner } from './parse'
import { runGh } from './gh-cli'
import { runGit } from '../git/cli'

/** Installed/authed are near-static and a repo's identity rarely changes, but the UI re-asks on
 * every session/repo/branch change — one minute coalesces those bursts. */
const DEFAULT_STATUS_TTL_MS = 60_000

export interface GhStatusProbeOptions {
  /** Injectable clock for testing the TTL (defaults to Date.now). */
  now?: () => number
  /** How long a status probe result stays fresh (defaults to 60s). */
  statusTtlMs?: number
  /** `git remote -v` output for a directory; injectable for tests. */
  listRemotes?: (cwd: string) => Promise<string>
}

const defaultListRemotes = async (cwd: string): Promise<string> => {
  const result = await runGit(cwd, ['remote', '-v'])
  return result.ok ? result.stdout : ''
}

interface AuthView {
  installed: boolean
  authed: boolean
}

interface RepoView {
  hasRemote: boolean
  nameWithOwner: string | null
}

interface Entry<T> {
  value: Promise<T>
  at: number
  /** The answer once the probe settled — lets a caller skip work a known answer makes moot. */
  settled?: T
}

const usable = (auth: AuthView) => auth.installed && auth.authed

export function createGhStatusProbe(options: GhStatusProbeOptions = {}) {
  const now = options.now ?? Date.now
  const ttl = options.statusTtlMs ?? DEFAULT_STATUS_TTL_MS

  let auth: Entry<AuthView> | null = null
  const repos = new Map<string, Entry<RepoView>>()

  const fresh = <T>(entry: Entry<T> | null | undefined, t: number): entry is Entry<T> =>
    entry != null && t - entry.at < ttl

  /** Records a running probe BEFORE it settles, so a concurrent caller joins it. */
  function remember<T>(probe: Promise<T>, t: number): Entry<T> {
    const entry: Entry<T> = { value: probe, at: t }
    void probe.then((settled) => {
      entry.settled = settled
    })
    return entry
  }

  function authView(cwd: string, t: number): Promise<AuthView> {
    if (fresh(auth, t)) return auth.value
    // `gh auth status` exits non-zero when logged out; ENOENT means no binary at all.
    const probe = runGh(cwd, ['auth', 'status']).then((r) => ({
      installed: !r.notFound,
      authed: r.ok,
    }))
    auth = remember(probe, t)
    return probe
  }

  function repoView(cwd: string, t: number): Promise<RepoView> {
    const hit = repos.get(cwd)
    if (fresh(hit, t)) return hit.value
    const probe = runGh(cwd, ['repo', 'view', '--json', 'nameWithOwner']).then((r) =>
      r.ok
        ? { hasRemote: true, nameWithOwner: parseNameWithOwner(r.stdout) }
        : { hasRemote: false, nameWithOwner: null },
    )
    repos.set(cwd, remember(probe, t))
    return probe
  }

  const shape = (a: AuthView, repo: RepoView | null): ForgeStatus => ({
    forge: 'github',
    installed: a.installed,
    authed: a.authed,
    hasRemote: repo?.hasRemote ?? false,
    nameWithOwner: repo?.nameWithOwner ?? null,
  })

  /** Only asked when `gh` is absent, and cached like the rest — one git spawn a minute at most. */
  const githubRemotes = new Map<string, Entry<boolean>>()
  function githubRemoteView(cwd: string, t: number): Promise<boolean> {
    const hit = githubRemotes.get(cwd)
    if (fresh(hit, t)) return hit.value
    const probe = (options.listRemotes ?? defaultListRemotes)(cwd).then((remotes) =>
      /github\.com[:/]/i.test(remotes),
    )
    githubRemotes.set(cwd, remember(probe, t))
    return probe
  }

  const withRemoteHint = async (a: AuthView, cwd: string, t: number): Promise<ForgeStatus> =>
    a.installed
      ? shape(a, null)
      : { ...shape(a, null), githubRemote: await githubRemoteView(cwd, t) }

  return async function status(cwd: string): Promise<ForgeStatus> {
    const t = now()
    // A fresh, settled "no gh / not signed in" makes the repo probe moot — do not spawn it.
    const known = fresh(auth, t) ? auth.settled : undefined
    if (known && !usable(known)) return withRemoteHint(known, cwd, t)
    const [a, repo] = await Promise.all([authView(cwd, t), repoView(cwd, t)])
    return usable(a) ? shape(a, repo) : withRemoteHint(a, cwd, t)
  }
}
