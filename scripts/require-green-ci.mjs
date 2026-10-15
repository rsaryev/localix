// Refuse to release a commit whose CI run on main did not succeed.
//
// CI (`ci.yml`) builds, type-checks and tests every push to main, including the Rust gates. The
// release used to repeat all of it; it now requires that run instead. A run still in progress is
// awaited, so a release dispatched right after the push does not fail on timing alone.
//
//   GH_TOKEN=<token> GITHUB_REPOSITORY=<owner/repo> COMMIT=<sha> bun scripts/require-green-ci.mjs
import { pathToFileURL } from 'node:url'

const WORKFLOW = 'ci.yml'
const POLL_MS = 20_000
const WAIT_MS = 30 * 60_000

/** The verdict for the newest CI run of a commit: `pass`, `wait` or a failure message. */
export function ciVerdict(runs, commit) {
  const run = runs
    .filter((candidate) => candidate.head_sha === commit && candidate.event === 'push')
    .sort((a, b) => b.run_number - a.run_number)[0]
  if (!run) return { state: 'wait', message: `no push CI run for ${commit} yet` }
  if (run.status !== 'completed')
    return { state: 'wait', message: `CI ${run.html_url} is ${run.status}` }
  if (run.conclusion === 'success') return { state: 'pass', message: `CI ${run.html_url} passed` }
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

async function main() {
  const { GITHUB_REPOSITORY: repo, COMMIT: commit } = process.env
  if (!repo || !commit) throw new Error('GITHUB_REPOSITORY and COMMIT are required')
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const verdict = ciVerdict(await listRuns(repo, commit), commit)
    console.log(verdict.message)
    if (verdict.state === 'pass') return
    if (verdict.state === 'fail') throw new Error(verdict.message)
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
