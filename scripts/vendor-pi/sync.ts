/**
 * Carry `vendor/pi` forward to upstream with a real `git merge`, keeping the Localix delta.
 *
 * WHY A MERGE AND NOT A COPY. `vendor/pi` is a fork: `UPSTREAM.md` records the deltas it carries.
 * A copy of upstream over the tree deletes every one of them and looks exactly like a successful
 * update. So upstream arrives as a snapshot commit (`snapshot.ts`) and `main` merges it — the merge
 * base is the previous snapshot, git's own machinery does the three-way merge (renames included),
 * and a conflict is left as ordinary unmerged paths, resolved with ordinary git.
 *
 *   sync       fetch upstream, build its snapshot, merge it; on a clean merge, finish
 *   continue   after resolving conflicts: guards, lockfile, then the merge commit
 *   abort      drop a sync in progress
 *   detect     the pre-commit question: is upstream ahead of what is merged?
 *
 * The sync is its own commit — never a side effect folded into someone's feature commit.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  INSTALL_TIMEOUT_MS,
  PACKAGES,
  PRUNED,
  TRAILER_UPSTREAM,
  TRAILER_VERSION,
  UPSTREAM_URL,
  VENDOR_DIR,
} from './config'
import { run, SyncFailure, UpstreamUnreachable } from './run'
import {
  buildSnapshot,
  findSnapshot,
  remoteHead,
  type ScriptDrift,
  type Snapshot,
} from './snapshot'
import { runTripwires, type Tripwire } from './tripwires'
import { deltaNotesFor, recordedUpstream, recordUpstream } from './upstream-doc'

export interface SyncContext {
  root: string
  url: string
  tripwires: readonly Tripwire[]
  /** Run `bun install` when the vendored dependency lists changed (off in hermetic tests). */
  install: boolean
  log: (line: string) => void
}

export type SyncOutcome = 'up-to-date' | 'synced' | 'conflicts' | 'guards-failed'

const git = (ctx: SyncContext, args: string[]) => run(['git', ...args], { cwd: ctx.root })
const short = (sha: string) => sha.slice(0, 12)
const slug = (url: string) => url.replace('https://github.com/', '')

async function mergeInProgress(ctx: SyncContext): Promise<string | undefined> {
  const head = await git(ctx, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  return head.ok && head.stdout ? head.stdout : undefined
}

async function trailer(ctx: SyncContext, rev: string, key: string): Promise<string | undefined> {
  const value = await git(ctx, [
    'log',
    '-1',
    `--format=%(trailers:key=${key},valueonly,separator=)`,
    rev,
  ])
  return value.ok && value.stdout ? value.stdout : undefined
}

async function unmergedPaths(ctx: SyncContext): Promise<string[]> {
  return (await git(ctx, ['diff', '--name-only', '--diff-filter=U'])).stdout
    .split('\n')
    .filter(Boolean)
}

/**
 * The first sync on a branch that predates snapshots: record the upstream commit `vendor/pi`
 * already holds as MERGED (`-s ours` keeps the tree exactly as it is), so the next sync has a merge
 * base git can find.
 */
async function register(ctx: SyncContext): Promise<Snapshot> {
  const recorded = await recordedUpstream(ctx.root)
  const snapshot = await buildSnapshot({ root: ctx.root, url: ctx.url, upstream: recorded })
  const merged = await git(ctx, [
    'merge',
    '-s',
    'ours',
    '--no-ff',
    // The first snapshot is a root: its history starts here, unrelated to main's until this merge.
    '--allow-unrelated-histories',
    '-m',
    `chore(vendor): register pi ${short(recorded)} as the merged snapshot\n\n` +
      `vendor/pi already holds upstream ${recorded} plus the Localix delta; this merge records that\n` +
      `snapshot so the next sync has a merge base git finds in history.`,
    snapshot.commit,
  ])
  if (!merged.ok)
    throw new SyncFailure('registering the current snapshot failed', merged.stderr || merged.stdout)
  ctx.log(
    `registered upstream ${short(recorded)} as the merged snapshot (${short(snapshot.commit)})`,
  )
  return snapshot
}

export async function sync(ctx: SyncContext): Promise<SyncOutcome> {
  if (await mergeInProgress(ctx)) {
    throw new SyncFailure(
      'a merge is already in progress',
      'Finish it (`bun run vendor:sync:continue`) or abort it first.',
    )
  }
  const dirty = await git(ctx, ['status', '--porcelain', '--', VENDOR_DIR])
  const staged = await git(ctx, ['diff', '--cached', '--quiet'])
  if (dirty.stdout || !staged.ok) {
    throw new SyncFailure(
      'the sync needs a clean vendor/pi and nothing staged',
      'It is its own commit. Commit or stash your work, then run it again.',
    )
  }

  const head = await remoteHead(ctx.url)
  const previous = (await findSnapshot(ctx.root)) ?? (await register(ctx))
  if (previous.upstream === head) {
    ctx.log(`vendor/pi is at upstream ${short(head)} — nothing to sync`)
    return 'up-to-date'
  }

  ctx.log(`building the upstream snapshot ${short(previous.upstream)} → ${short(head)} …`)
  const snapshot = await buildSnapshot({
    root: ctx.root,
    url: ctx.url,
    upstream: head,
    base: previous.upstream,
    parent: previous.commit,
  })
  const version = await git(ctx, ['--version'])
  const [, major = '0', minor = '0'] = version.stdout.match(/git version (\d+)\.(\d+)/) ?? []
  const conflictStyle =
    Number(major) > 2 || (Number(major) === 2 && Number(minor) >= 35) ? 'zdiff3' : 'diff3'
  const merged = await git(ctx, [
    '-c',
    `merge.conflictStyle=${conflictStyle}`,
    '-c',
    'rerere.enabled=true',
    '-c',
    'rerere.autoUpdate=true',
    'merge',
    '--no-ff',
    '--no-commit',
    '-m',
    `chore(vendor): sync pi ${short(previous.upstream)} → ${short(head)}\n\n` +
      `${ctx.url}/compare/${previous.upstream}...${head}\n\n` +
      `The Localix delta (vendor/pi/UPSTREAM.md) is kept; its guards ran before this commit.`,
    snapshot.commit,
  ])
  reportDrift(ctx, snapshot.drift)

  const conflicts = await unmergedPaths(ctx)
  if (conflicts.length > 0) {
    await reportConflicts(ctx, conflicts)
    return 'conflicts'
  }
  if (!merged.ok) throw new SyncFailure('the snapshot merge failed', merged.stderr || merged.stdout)
  return finish(ctx, previous.upstream)
}

/** Finish a sync whose conflicts (if any) are resolved: guards, lockfile, record, commit. */
export async function finish(ctx: SyncContext, previousUpstream?: string): Promise<SyncOutcome> {
  const mergeHead = await mergeInProgress(ctx)
  const upstream = mergeHead ? await trailer(ctx, mergeHead, TRAILER_UPSTREAM) : undefined
  if (!mergeHead || !upstream)
    throw new SyncFailure('no vendor sync is in progress', 'Start one with `bun run vendor:sync`.')

  await git(ctx, ['add', '-A', '--', VENDOR_DIR])
  const conflicts = await unmergedPaths(ctx)
  if (conflicts.length > 0) {
    await reportConflicts(ctx, conflicts)
    return 'conflicts'
  }
  for (const path of PRUNED) {
    if (existsSync(join(ctx.root, VENDOR_DIR, path)))
      await git(ctx, ['rm', '-rq', '--', `${VENDOR_DIR}/${path}`])
  }

  await recordUpstream(
    ctx.root,
    upstream,
    (await trailer(ctx, mergeHead, TRAILER_VERSION)) ?? 'unknown',
  )
  if (ctx.install && (await dependenciesChanged(ctx))) {
    ctx.log('vendored dependencies changed — bun install …')
    const install = await run(['bun', 'install'], { cwd: ctx.root, timeoutMs: INSTALL_TIMEOUT_MS })
    if (!install.ok)
      throw new SyncFailure('bun install failed after the merge', install.stderr || install.stdout)
  }
  // One pathspec that does not exist makes `git add` add NOTHING, so the lockfile is its own step.
  await git(ctx, ['add', '-A', '--', VENDOR_DIR])
  if (existsSync(join(ctx.root, 'bun.lock'))) await git(ctx, ['add', '--', 'bun.lock'])

  const results = await runTripwires(ctx.root, ctx.tripwires)
  const failed = results.filter((result) => !result.ok)
  if (failed.length > 0) {
    for (const { tripwire, output } of failed) {
      ctx.log(
        `\nguard FAILED — ${tripwire.delta}: ${tripwire.path}\n${output.split('\n').slice(-25).join('\n')}`,
      )
    }
    ctx.log(
      '\nThe merge dropped or broke a Localix delta. Fix it in place (vendor/pi/UPSTREAM.md says what\n' +
        'each delta is for), then `bun run vendor:sync:continue`. Nothing is committed yet.',
    )
    return 'guards-failed'
  }

  const committed = await git(ctx, ['commit', '--no-edit'])
  if (!committed.ok)
    throw new SyncFailure('the sync commit failed', committed.stderr || committed.stdout)
  ctx.log(
    `vendor/pi synced to upstream ${short(upstream)} — ${results.length} delta guard(s) green`,
  )
  reportUpstream(ctx, previousUpstream, upstream)
  return 'synced'
}

export async function abort(ctx: SyncContext): Promise<void> {
  const mergeHead = await mergeInProgress(ctx)
  if (!mergeHead || !(await trailer(ctx, mergeHead, TRAILER_UPSTREAM)))
    throw new SyncFailure('no vendor sync is in progress')
  const aborted = await git(ctx, ['merge', '--abort'])
  if (!aborted.ok) throw new SyncFailure('git merge --abort failed', aborted.stderr)
  ctx.log('vendor sync aborted; the tree is as it was')
}

/**
 * The pre-commit question. Behind → the commit stops with the one command that fixes it. Offline →
 * a warning: an unreachable network is not a reason to refuse someone's commit. A merge being
 * concluded is never stopped — that includes the sync's own commit.
 */
export async function detect(ctx: SyncContext): Promise<'current' | 'behind' | 'offline'> {
  if (await mergeInProgress(ctx)) return 'current'
  const recorded = await recordedUpstream(ctx.root)
  let head: string
  try {
    head = await remoteHead(ctx.url)
  } catch (error) {
    if (!(error instanceof UpstreamUnreachable)) throw error
    ctx.log(`vendor/pi: upstream not reachable (${error.message}); not checked this time`)
    return 'offline'
  }
  if (head === recorded) return 'current'
  ctx.log(
    `vendor/pi is behind upstream: ${short(recorded)} → ${short(head)}\n` +
      `  sync it as its own commit:   bun run vendor:sync\n` +
      `  what changed:                gh api repos/${slug(ctx.url)}/compare/${recorded}...${head} --jq '.commits[].commit.message'`,
  )
  return 'behind'
}

async function dependenciesChanged(ctx: SyncContext): Promise<boolean> {
  const depsOf = (text: string) => {
    const manifest = JSON.parse(text) as Record<string, unknown>
    return JSON.stringify([
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ])
  }
  for (const pkg of PACKAGES) {
    const path = `${VENDOR_DIR}/${pkg}/package.json`
    const before = await git(ctx, ['show', `HEAD:${path}`])
    const after = Bun.file(join(ctx.root, path))
    if (!before.ok || !(await after.exists())) return true
    if (depsOf(before.stdout) !== depsOf(await after.text())) return true
  }
  return false
}

async function reportConflicts(ctx: SyncContext, paths: string[]): Promise<void> {
  ctx.log(`\n${paths.length} file(s) conflict with the Localix delta:`)
  for (const path of paths) {
    ctx.log(`\n  ${path}`)
    for (const note of await deltaNotesFor(ctx.root, path))
      ctx.log(`    delta: ${note.slice(0, 400)}`)
  }
  ctx.log(
    '\nResolve them as any merge (markers show ours / base / upstream):\n' +
      '  keep upstream, then re-apply our delta:   git checkout --theirs <path>\n' +
      "  keep ours, then take upstream's change:   git checkout --ours <path>\n" +
      '  a file with no delta note above is pure upstream: take theirs.\n' +
      'Then: bun run vendor:sync:continue   (guards run before anything is committed)\n' +
      'Or:   bun run vendor:sync:abort\n' +
      'rerere is on for this merge, so a resolution you make once is replayed next time.',
  )
}

function reportDrift(ctx: SyncContext, drift: readonly ScriptDrift[]): void {
  if (drift.length === 0) return
  ctx.log(
    '\nupstream changed scripts Localix owns — ours were kept; decide whether ours should follow:',
  )
  for (const d of drift) {
    ctx.log(
      `  ${d.manifest} "${d.key}": upstream ${JSON.stringify(d.base)} → ${JSON.stringify(d.head)}, ours ${JSON.stringify(d.ours)}`,
    )
  }
}

function reportUpstream(ctx: SyncContext, from: string | undefined, to: string): void {
  const range = from ? `${from}...${to}` : to
  ctx.log(
    [
      '',
      'read what arrived before moving on:',
      `  gh api repos/${slug(ctx.url)}/compare/${range} --jq '.commits[].commit.message'`,
      `  gh release list --repo ${slug(ctx.url)} --limit 5`,
      'then decide what Localix should do with it:',
      '  • a provider capability or model field the adapter could surface — packages/agent-runtime-pi/src/models.ts',
      '  • a delta upstream has adopted — move it to "Adopted upstream" in vendor/pi/UPSTREAM.md and drop the diff',
      '  • a behaviour change in the agent loop or a transport — the guards prove the fork survived, not our assumptions',
      '  • anything user-visible — the docs/ page ships in the same commit',
      'verify: bun run type-check && bun run check:tests && bun run test',
    ].join('\n'),
  )
}

export const defaultContext = (root: string, tripwires: readonly Tripwire[]): SyncContext => ({
  root,
  url: UPSTREAM_URL,
  tripwires,
  install: true,
  log: (line) => console.error(line),
})
