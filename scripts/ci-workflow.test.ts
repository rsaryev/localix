import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
type Step = {
  name?: string
  shell?: string
  run?: string
  uses?: string
  if?: string
  'continue-on-error'?: boolean
  with?: Record<string, string>
}
type Job = {
  steps: Step[]
  needs?: string[]
  if?: string
  'runs-on': string | string[]
  'timeout-minutes'?: number
  env?: Record<string, string>
  strategy?: {
    'fail-fast'?: boolean
    matrix: { include: { check: string; cache: string; run: string }[] }
  }
}
type Workflow = {
  env?: Record<string, string>
  jobs: Record<string, Job>
  concurrency: { group: string; 'cancel-in-progress': string }
}
const ci = Bun.YAML.parse(read('.github/workflows/ci.yml')) as Workflow
const release = Bun.YAML.parse(read('.github/workflows/release.yml')) as Workflow
const landing = Bun.YAML.parse(read('.github/workflows/landing.yml')) as Workflow
// Unit tests run in CI on our own runner, where a busy laptop cannot make them flaky; integration
// tests, the bundle and coverage run on demand.
const gates = ['type-check', 'check:tests', 'check:size', 'test']
const slices = ci.jobs.app.strategy?.matrix.include ?? []
/** Every `bun run <script>` the app matrix runs, slice by slice. */
const sliceCommands = slices.flatMap((slice) =>
  slice.run
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
)

describe('CI minute budget contract', () => {
  test('Checks and the website run on our runner; a fork and the release stay on GitHub', () => {
    const ours = "${{ github.event.pull_request.head.repo.fork && 'ubuntu-24.04' || 'localix' }}"
    for (const job of Object.values(ci.jobs)) expect(job['runs-on']).toBe(ours)
    expect(landing.jobs.deploy['runs-on']).toBe('localix')
    for (const [name, job] of Object.entries(release.jobs)) {
      expect(job['runs-on']).toBe(name === 'build-desktop' ? '${{ matrix.os }}' : 'ubuntu-24.04')
    }
  })

  test('packages macOS on macos-15 and Linux on ubuntu-22.04', () => {
    const workflow = read('.github/workflows/release.yml')
    expect(workflow).toContain('{"os":"macos-15","name":"macos-arm64"}')
    expect(workflow).toContain('{"os":"ubuntu-22.04","name":"linux-x64"')
  })

  test('shares pinned Node, Bun, dependencies, and Rust setup across workflows', () => {
    const workspace = Bun.YAML.parse(read('.github/actions/setup-workspace/action.yml')) as {
      runs: { steps: Step[] }
    }
    const desktop = Bun.YAML.parse(read('.github/actions/setup-desktop/action.yml')) as {
      runs: { steps: Step[] }
    }
    const bun = workspace.runs.steps.find((step) => step.uses?.startsWith('oven-sh/setup-bun@'))
    expect(bun?.with?.['no-cache']).toBeUndefined()
    expect(
      workspace.runs.steps.find((step) => step.name === 'Setup Node')?.with?.['node-version-file'],
    ).toBe('.nvmrc')
    const install = workspace.runs.steps.find((step) => step.name === 'Install dependencies')
    expect(install?.run).toContain('bun install --frozen-lockfile')
    expect(install?.run).toContain('--ignore-scripts')
    expect(
      desktop.runs.steps.find((step) => step.name === 'Cache Rust compilation')?.with?.[
        'cache-on-failure'
      ],
    ).toBe(true)
    for (const workflow of [ci, release, landing]) {
      // The aggregate status job only reads the other jobs' results.
      for (const job of Object.values(workflow.jobs).filter((job) => job !== ci.jobs.checks)) {
        expect(
          job.steps.filter((step) => step.uses === './.github/actions/setup-workspace'),
        ).toHaveLength(1)
      }
    }
  })

  test('invalidates task caches when the Node toolchain changes', () => {
    expect(JSON.parse(read('turbo.json')).globalDependencies).toContain('.nvmrc')
  })

  test('gives checks, desktop releases, and website deployments distinct names', () => {
    expect(Bun.YAML.parse(read('.github/workflows/ci.yml')).name).toBe('Checks')
    expect(Bun.YAML.parse(read('.github/workflows/release.yml')).name).toBe('Desktop Release')
    expect(Bun.YAML.parse(read('.github/workflows/landing.yml')).name).toBe('Website Deploy')
  })

  test('restores dependencies from a GitHub cache archive keyed by the lockfile', () => {
    const workspace = Bun.YAML.parse(read('.github/actions/setup-workspace/action.yml')) as {
      runs: { steps: Step[] }
    }
    const archive = workspace.runs.steps.find((step) => step.name === 'Cache dependencies')
    expect(archive?.if).toBe("inputs.install == 'true'")
    expect(archive?.with?.path).toBe('~/.bun/install/cache')
    expect(archive?.with?.key).toContain("hashFiles('bun.lock')")
  })

  test('bounds the Turbo archive before main saves it', () => {
    const steps = ci.jobs.app.steps
    const prune = steps.findIndex((step) => step.name === 'Prune Turbo cache')
    const save = steps.findIndex((step) => step.name === 'Save Turbo cache')
    expect(prune).toBeGreaterThan(-1)
    expect(prune).toBeLessThan(save)
    expect(steps[prune]?.run).toContain('-mtime +14 -delete')
    expect(steps[save]?.if).toContain("github.ref == 'refs/heads/main'")
  })

  test('runs on pull requests, pushes to main and by hand; there is no merge queue', () => {
    const on = Bun.YAML.parse(read('.github/workflows/ci.yml')).on as Record<string, unknown>
    expect(Object.keys(on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch'])
  })

  test('a push that changes only documentation or media starts no run', () => {
    const push = (Bun.YAML.parse(read('.github/workflows/ci.yml')).on as Record<string, unknown>)
      .push as { 'paths-ignore': string[] }
    expect(push['paths-ignore']).toEqual(['docs/**', '**/*.md', 'assets/**'])
  })

  test('history is fetched only where --affected reads it', () => {
    expect(ci.jobs.app.steps[0]?.with?.['fetch-depth']).toBe(
      "${{ github.event_name == 'pull_request' && 0 || 1 }}",
    )
  })

  test('the Rust gate runs unless a pull request or push changed none of its inputs', () => {
    const detect = ci.jobs.desktop.steps.find((step) => step.name === 'Detect Rust input changes')
    expect(detect?.run).toContain("base='HEAD^1'")
    // A push compares with main's last successful run, so the commits of a run main skipped are
    // still checked; no such run, or one a force-push erased, leaves no base and the gate runs.
    expect(detect?.run).toContain('--workflow ci.yml --branch main --event push --status success')
    expect(detect?.run).toContain('base="$last"')
    expect(detect?.run).toContain('git cat-file -e "$last^{commit}"')
    expect(detect?.run).toMatch(/^rust=true$/mu)
  })

  test('dependencies are updated by hand: no Dependabot configuration', () => {
    expect(existsSync(join(root, '.github/dependabot.yml'))).toBe(false)
  })

  test('deploys the website and starts a release by hand only', () => {
    for (const file of ['landing', 'release']) {
      const on = Bun.YAML.parse(read(`.github/workflows/${file}.yml`)).on as Record<string, unknown>
      expect(Object.keys(on)).toEqual(['workflow_dispatch'])
    }
  })

  test('queues website deployments instead of cancelling one in flight', () => {
    expect(landing.concurrency.group).toBe('landing-production')
    expect(landing.concurrency['cancel-in-progress']).toBe(false)
  })

  test('checks the workspace as parallel slices that together run every gate', () => {
    const app = ci.jobs.app
    expect(app.strategy?.['fail-fast']).toBe(false)
    expect(slices.map((slice) => slice.cache)).toEqual(['types', 'unit'])
    expect([...sliceCommands].sort()).toEqual(gates.map((gate) => `bun run ${gate}`).sort())
    // One install and one build per slice, the build before the slice's own commands.
    const runs = app.steps.map((step) => step.run ?? step.uses ?? '')
    expect(runs.filter((run) => run === './.github/actions/setup-workspace')).toHaveLength(1)
    expect(runs.filter((run) => run === 'bun run build')).toHaveLength(1)
    const build = runs.indexOf('bun run build')
    const check = app.steps.findIndex((step) => step.name === 'Check ${{ matrix.check }}')
    expect(check).toBeGreaterThan(build)
    expect(app.steps[check]?.if).toBeUndefined()
    expect(app.steps[check]?.['continue-on-error']).toBeUndefined()
    expect(ci.env?.RUST_TOOLCHAIN).toBe('1.96.1')
    // The step runs under bash with pipefail, so piping the log through tee keeps the exit code, and
    // the slice's commands run under -e, so the first failing one fails the slice (not only the last).
    expect(app.steps[check]?.shell).toBe('bash')
    expect(app.steps[check]?.run).toBe(
      'bash -eo pipefail -c "$CHECK" 2>&1 | tee "$RUNNER_TEMP/check.log"',
    )
    const summary = app.steps[check + 1]
    expect(summary?.if).toBe('failure()')
    expect(summary?.run).toContain('bun scripts/ci-failure-summary.mjs')
    expect(summary?.run).toContain('>> "$GITHUB_STEP_SUMMARY"')
  })

  test('the slices run the two tiers a local run has, through Turbo and its cache', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    expect(scripts.test).toBe(
      'bunx turbo test --concurrency=${TURBO_CONCURRENCY:-50%} ${TURBO_FILTER:-}',
    )
    expect(scripts['test:integration']).toBe(
      'bunx turbo test:integration --concurrency=${TURBO_CONCURRENCY:-50%} ${TURBO_FILTER:-}',
    )
  })

  test('release verification requires green CI instead of repeating its gates', () => {
    expect(release.jobs.prepare.steps.map((step) => step.run ?? '').join('\n')).toContain(
      'bun scripts/require-green-ci.mjs',
    )
    const verify = release.jobs.verify.steps.map((step) => step.run ?? '').join('\n')
    expect(verify.match(/^\s*bun run .+$/gmu)).toBeNull()
  })

  test('scans secrets and workflows beside Rust, and reports one status', () => {
    expect(Object.keys(ci.jobs)).toEqual(['app', 'desktop', 'checks'])
    expect(ci.jobs.desktop.needs).toBeUndefined()
    expect(ci.jobs.desktop.if).toBeUndefined()
    const steps = ci.jobs.desktop.steps
    expect(steps[0]?.with?.['fetch-depth']).toBe(0)
    const install = steps.find((step) => step.name === 'Install pinned scanners')
    expect(install?.run).toContain('sha256sum -c -')
    for (const tool of ['gitleaks', 'actionlint', 'zizmor']) expect(install?.run).toContain(tool)
    const scan = steps.find((step) => step.name === 'Scan history for secrets')
    expect(scan?.run).toContain('--config .gitleaks.toml')
    // Only the commits since the base are scanned; with no base, the whole history.
    expect(scan?.run).toContain('${BASE:+--log-opts="$BASE..HEAD"}')
    const lint = steps.find((step) => step.name === 'Lint workflows')
    expect(lint?.run).toContain('"$RUNNER_TEMP/actionlint"')
    expect(lint?.run).toContain('"$RUNNER_TEMP/zizmor" --offline --min-severity medium .github')
    // The workflows are linted only when a change reaches `.github` (or nothing is known).
    expect(scan?.if).toBeUndefined()
    expect(lint?.if).toBe("steps.filter.outputs.workflows == 'true'")
    const detect = steps.findIndex((s) => s.name === 'Detect Rust input changes')
    for (const step of [scan, lint]) expect(steps.indexOf(step!)).toBeGreaterThan(detect)
    const rustCheck = steps.find((step) => step.run === 'bun run check:rust')
    expect(rustCheck?.if).toBe("steps.filter.outputs.rust == 'true'")
  })

  test('requires every job through one status that names each result', () => {
    const checks = ci.jobs.checks
    expect(checks.needs).toEqual(['app', 'desktop'])
    expect(checks.if).toBe('always()')
    const run = checks.steps.map((step) => step.run ?? '').join('\n')
    expect(run).toContain('.result == "success" or .result == "skipped"')
    expect(run).toContain('"\\(.key): \\(.value.result)"')
  })

  test('every job has a deadline sized for a hosted runner', () => {
    for (const [name, job] of Object.entries(ci.jobs))
      expect({ name, minutes: job['timeout-minutes'] }).toEqual({
        name,
        minutes: name === 'checks' ? 5 : name === 'desktop' ? 30 : 25,
      })
  })

  test('a pull request checks what it changes; main checks everything', () => {
    expect(ci.jobs.app.env).toEqual({
      TURBO_FILTER: "${{ github.event_name == 'pull_request' && '--affected' || '' }}",
      TURBO_SCM_BASE: '${{ github.event.pull_request.base.sha }}',
      // The coverage gate also holds a pull request's changed lines to the threshold.
      COVERAGE_BASE: '${{ github.event.pull_request.base.sha }}',
    })
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    for (const gate of ['type-check', 'check:tests', 'test', 'test:integration'])
      expect(scripts[gate]).toContain('${TURBO_FILTER:-}')
    // The repository tests run on every change and import built packages, so the build is never
    // filtered; Turbo replays every unchanged package from the cache main saved.
    expect(scripts.build).toBe('bunx turbo build')
  })

  test('cancels a superseded pull-request run, never a run in progress on main', () => {
    // Main shares one group: a run in progress finishes (and saves its cache) while only the newest
    // waiting run is kept. A manual run, which a release asks for, has a group per commit.
    expect(ci.concurrency.group).toContain("format('ci-pr-{0}', github.event.pull_request.number)")
    expect(ci.concurrency.group).toContain("github.event_name == 'push' && 'ci-main'")
    expect(ci.concurrency.group).toContain("format('ci-{0}-{1}', github.event_name, github.sha)")
    expect(ci.concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}")
  })

  test('each slice restores its own Turbo archive before building, and only main saves it', () => {
    const steps = ci.jobs.app.steps
    const restore = steps.findIndex((step) => step.name === 'Restore Turbo cache')
    const build = steps.findIndex((step) => step.run === 'bun run build')
    expect(restore).toBeGreaterThan(-1)
    expect(build).toBeGreaterThan(restore)
    expect(steps[restore]?.with?.key).toContain('turbo-${{ matrix.cache }}-')
    expect(steps[restore]?.with?.['restore-keys']).toBe(
      "turbo-${{ matrix.cache }}-${{ runner.os }}-${{ hashFiles('bun.lock') }}-\nturbo-${{ matrix.cache }}-${{ runner.os }}-\n",
    )
    const save = steps.find((step) => step.name === 'Save Turbo cache')
    expect(save?.with?.key).toBe(steps[restore]?.with?.key)
    expect(save?.if).toContain('always()')
    expect(save?.if).toContain("github.ref == 'refs/heads/main'")
  })

  test('drops superseded Turbo archives from the one job that may write to the cache', () => {
    const checks = ci.jobs.checks as Job & { permissions?: Record<string, string> }
    expect(checks.permissions).toEqual({ actions: 'write' })
    const drop = checks.steps.find((step) => step.name === 'Drop superseded Turbo archives')
    expect(drop?.if).toContain("github.ref == 'refs/heads/main'")
    for (const slice of slices) expect(drop?.run).toContain(slice.cache)
    expect(drop?.run).toContain("'.[1:][].id'")
    // The job that runs repository code never holds the write access.
    expect((ci.jobs.app as Job & { permissions?: Record<string, string> }).permissions).toEqual({
      contents: 'read',
    })
  })
})
