// Refuse to release a commit whose CI run did not succeed.
//
// CI (`ci.yml`) builds, type-checks and tests pushes to main, including the Rust gates. The release
// does not repeat it; it requires that run instead. Main runs one CI at a time and keeps only the
// newest waiting one, and skips documentation-only pushes, so a tagged commit may have no run, or a
// cancelled one. The release then asks for a run of that commit itself (a manual run of the tag)
// and waits for it, so a release is never held up by a run main chose not to spend. A run still in
// progress is awaited.
//
//   GH_TOKEN=<token> GITHUB_REPOSITORY=<owner/repo> COMMIT=<sha> TAG=<tag> bun scripts/require-green-ci.mjs
import { pathToFileURL } from 'node:url'

const WORKFLOW = 'ci.yml'
const POLL_MS = 20_000
const WAIT_MS = 30 * 60_000

/**
 * The verdict for the newest CI run of a commit: `pass`, `wait`, `dispatch` (ask for a run; only
 * once, after which a missing run is awaited and a cancelled one fails) or a failure message.
 */
export function ciVerdict(runs, commit, dispatched = false) {
  const run = runs
    .filter(
      (candidate) =>
        candidate.head_sha === commit &&
        (candidate.event === 'push' || candidate.event === 'workflow_dispatch'),
    )
    .sort((a, b) => b.run_number - a.run_number)[0]
  if (!run) {
    return dispatched
      ? { state: 'wait', message: `waiting for the requested CI run for ${commit}` }
      : { state: 'dispatch', message: `no CI run for ${commit}; requesting one` }
  }
  if (run.status !== 'completed')
    return { state: 'wait', message: `CI ${run.html_url} is ${run.status}` }
  if (run.conclusion === 'success') return { state: 'pass', message: `CI ${run.html_url} passed` }
  if (!dispatched && (run.conclusion === 'cancelled' || run.conclusion === 'skipped'))
    return {
      state: 'dispatch',
      message: `CI ${run.html_url} was ${run.conclusion}; requesting one`,
    }
  return {
    state: 'fail',
    message: `CI ${run.html_url} concluded ${run.conclusion}; fix main before releasing ${commit}`,
  }
}

async function listRuns(repo, commit) {
  const proc = Bun.spawn(
    [
      'gh',
      'api',
      `repos/${repo}/actions/workflows/${WORKFLOW}/runs?head_sha=${commit}&per_page=20`,
    ],
    { stdout: 'pipe', stderr: 'inherit' },
  )
  const body = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) throw new Error('could not list CI runs')
  return JSON.parse(body).workflow_runs
}

async function requestRun(repo, tag) {
  const proc = Bun.spawn(['gh', 'workflow', 'run', WORKFLOW, '--repo', repo, '--ref', tag], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await proc.exited) !== 0) throw new Error(`could not request a CI run for ${tag}`)
}

async function main() {
  const { GITHUB_REPOSITORY: repo, COMMIT: commit, TAG: tag } = process.env
  if (!repo || !commit || !tag) throw new Error('GITHUB_REPOSITORY, COMMIT and TAG are required')
  const deadline = Date.now() + WAIT_MS
  let dispatched = false
  for (;;) {
    const verdict = ciVerdict(await listRuns(repo, commit), commit, dispatched)
    console.log(verdict.message)
    if (verdict.state === 'pass') return
    if (verdict.state === 'fail') throw new Error(verdict.message)
    if (verdict.state === 'dispatch') {
      await requestRun(repo, tag)
      dispatched = true
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting: ${verdict.message}`)
    await Bun.sleep(POLL_MS)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
