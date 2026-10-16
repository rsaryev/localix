/**
 * A SNAPSHOT: one commit holding exactly the upstream tree of the vendored packages at one upstream
 * commit, with the fork's manifest policy applied — and nothing else.
 *
 * Snapshots form their own line of history (each one's parent is the previous snapshot), and `main`
 * merges them like any branch. That is what lets git do the merge natively: the merge base is the
 * previous snapshot, found through history rather than a sha pasted into a document; renames are
 * detected; a conflict is an ordinary unmerged path; `rerere` remembers a resolution.
 *
 * A snapshot is DETERMINISTIC — fixed author and message, dated by the upstream commit, parented on
 * the previous snapshot — so two machines that sync the same upstream from the same point produce
 * the same sha, and their merges converge instead of conflicting with each other.
 *
 * Objects travel without making this repository shallow: upstream is fetched into a scratch
 * repository, and only the vendored blobs are packed across.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scratchGitEnv } from '../scratch-git-env'
import {
  FETCH_TIMEOUT_MS,
  LS_REMOTE_TIMEOUT_MS,
  PACKAGES,
  PRUNED,
  TRAILER_UPSTREAM,
  TRAILER_VERSION,
  UPSTREAM_BRANCH,
  VENDOR_DIR,
} from './config'
import { applyManifestPolicy, ownedScriptDrift, ownership } from './manifest-policy'
import { run, SyncFailure, UpstreamUnreachable } from './run'

export interface Snapshot {
  commit: string
  upstream: string
}

export interface ScriptDrift {
  manifest: string
  key: string
  base?: string
  head?: string
  ours?: string
}

type Env = Record<string, string | undefined>

/**
 * A git command whose output is kept byte-exact (blob contents must not lose a trailing newline)
 * and which may be fed stdin. Fails loudly: every call here is a step the snapshot cannot skip.
 */
async function git(
  cwd: string,
  args: string[],
  what: string,
  options: { env?: Env; stdin?: string } = {},
) {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    // Explicit for the reason `run.ts` gives: Bun's default is the START-UP environment.
    env: options.env ?? process.env,
    ...(options.stdin !== undefined ? { stdin: new TextEncoder().encode(options.stdin) } : {}),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if ((await proc.exited) !== 0) throw new SyncFailure(what, stderr.trim() || stdout.trim())
  return stdout
}

/** The sha upstream's branch points at now. */
export async function remoteHead(url: string): Promise<string> {
  const result = await run(['git', 'ls-remote', url, `refs/heads/${UPSTREAM_BRANCH}`], {
    env: scratchGitEnv(),
    timeoutMs: LS_REMOTE_TIMEOUT_MS,
  })
  const sha = result.stdout.split(/\s+/)[0]
  if (!result.ok || !sha) {
    throw new UpstreamUnreachable(
      `could not reach ${url}${result.timedOut ? ` within ${LS_REMOTE_TIMEOUT_MS / 1000}s` : ''}`,
      result.stderr,
    )
  }
  return sha
}

/** The newest snapshot this branch has merged, found by its trailer in history. */
export async function findSnapshot(root: string, rev = 'HEAD'): Promise<Snapshot | undefined> {
  const found = await run(
    [
      'git',
      'log',
      '-1',
      '-E',
      `--grep=^${TRAILER_UPSTREAM}: [0-9a-f]{40}$`,
      `--format=%H %(trailers:key=${TRAILER_UPSTREAM},valueonly,separator=)`,
      rev,
    ],
    { cwd: root },
  )
  const [commit, upstream] = found.stdout.split(/\s+/)
  return found.ok && commit && upstream ? { commit, upstream } : undefined
}

/** Build (or rebuild — it is deterministic) the snapshot of `upstream`. */
export async function buildSnapshot(options: {
  root: string
  url: string
  upstream: string
  /** The upstream commit the previous snapshot holds: what Localix's owned scripts are measured against. */
  base?: string
  parent?: string
}): Promise<Snapshot & { drift: ScriptDrift[] }> {
  const { root, url, upstream } = options
  const scratch = await mkdtemp(join(tmpdir(), 'localix-pi-snapshot-'))
  const env = scratchGitEnv()
  try {
    await git(scratch, ['init', '--quiet'], 'scratch init failed', { env })
    const wanted = [...new Set([upstream, options.base].filter((sha): sha is string => !!sha))]
    const fetched = await run(['git', 'fetch', '--quiet', '--depth', '1', url, ...wanted], {
      cwd: scratch,
      env,
      timeoutMs: FETCH_TIMEOUT_MS,
    })
    if (!fetched.ok) {
      throw new UpstreamUnreachable(
        `could not fetch ${upstream.slice(0, 12)} from ${url}${fetched.timedOut ? ' (timed out)' : ''}`,
        fetched.stderr,
      )
    }

    // Mode, type, sha and path of every vendored file, minus the pruned trees.
    const listing = await git(
      scratch,
      ['ls-tree', '-r', '--full-tree', upstream, '--', ...PACKAGES],
      'listing upstream failed',
      { env },
    )
    const entries = listing
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [meta, path] = line.split('\t') as [string, string]
        const [mode, type, sha] = meta.split(' ') as [string, string, string]
        return { mode, type, sha, path }
      })
      .filter(
        (entry) => entry.type === 'blob' && !PRUNED.some((prefix) => entry.path.startsWith(prefix)),
      )
    if (entries.length === 0)
      throw new SyncFailure(`upstream ${upstream.slice(0, 12)} has no vendored files`)

    // Pack exactly those blobs across; `index-pack` keeps them as one pack in this repository.
    const pack = Bun.spawn(['git', 'pack-objects', '--stdout', '--quiet'], {
      cwd: scratch,
      env,
      stdin: new TextEncoder().encode(`${[...new Set(entries.map((e) => e.sha))].join('\n')}\n`),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const index = Bun.spawn(['git', 'index-pack', '--stdin'], {
      cwd: root,
      stdin: pack.stdout,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if ((await pack.exited) !== 0 || (await index.exited) !== 0) {
      throw new SyncFailure(
        'copying the upstream objects failed',
        await new Response(index.stderr).text(),
      )
    }

    // The manifests carry the fork's decisions (`manifest-policy.ts`).
    const drift: ScriptDrift[] = []
    for (const entry of entries) {
      if (!PACKAGES.some((pkg) => entry.path === `${pkg}/package.json`)) continue
      const ours = await readFile(join(root, VENDOR_DIR, entry.path), 'utf8').catch(() => undefined)
      if (ours === undefined) continue
      const head = await git(
        scratch,
        ['cat-file', 'blob', entry.sha],
        'reading a manifest failed',
        { env },
      )
      const base = options.base
        ? await git(
            scratch,
            ['show', `${options.base}:${entry.path}`],
            'reading a base manifest failed',
            { env },
          ).catch(() => head)
        : head
      for (const item of ownedScriptDrift(ours, base, head))
        drift.push({ manifest: entry.path, ...item })
      const patched = applyManifestPolicy(head, ours, { ownership: ownership(ours, base) })
      if (patched === head) continue
      entry.sha = (
        await git(root, ['hash-object', '-w', '--stdin'], 'writing a policy manifest failed', {
          stdin: patched,
        })
      ).trim()
    }

    // The tree, built in a private index so the working index is never touched.
    const indexEnv = { ...process.env, GIT_INDEX_FILE: join(scratch, 'snapshot.index') }
    await git(
      root,
      ['update-index', '--add', '--index-info'],
      'building the snapshot tree failed',
      {
        env: indexEnv,
        stdin: `${entries.map((e) => `${e.mode} ${e.sha}\t${VENDOR_DIR}/${e.path}`).join('\n')}\n`,
      },
    )
    const tree = (
      await git(root, ['write-tree'], 'writing the snapshot tree failed', { env: indexEnv })
    ).trim()

    const date = (
      await git(
        scratch,
        ['show', '-s', '--format=%cI', upstream],
        'reading the upstream date failed',
        { env },
      )
    ).trim()
    const aiManifest = entries.find((e) => e.path === 'packages/ai/package.json')
    const version = aiManifest
      ? (JSON.parse(
          await git(root, ['cat-file', 'blob', aiManifest.sha], 'reading the version failed'),
        ).version as string)
      : 'unknown'
    const who = { name: 'pi upstream', email: 'vendor-pi@localix.invalid' }
    const commit = await git(
      root,
      [
        '-c',
        'commit.gpgSign=false',
        'commit-tree',
        tree,
        ...(options.parent ? ['-p', options.parent] : []),
      ],
      'committing the snapshot failed',
      {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: who.name,
          GIT_AUTHOR_EMAIL: who.email,
          GIT_COMMITTER_NAME: who.name,
          GIT_COMMITTER_EMAIL: who.email,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
        stdin:
          `vendor(pi): upstream ${upstream.slice(0, 12)}\n\n` +
          `The upstream tree of ${PACKAGES.join(', ')} with the fork's manifest policy applied\n` +
          `(scripts/vendor-pi/manifest-policy.ts). Merged into main by \`bun run vendor:sync\`.\n\n` +
          `${TRAILER_UPSTREAM}: ${upstream}\n${TRAILER_VERSION}: ${version}\n`,
      },
    )
    return { commit: commit.trim(), upstream, drift }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
