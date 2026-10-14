import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
type Step = {
  name?: string
  run?: string
  uses?: string
  if?: string
  'continue-on-error'?: boolean
  with?: Record<string, string>
}
type Job = { steps: Step[]; needs?: string[]; if?: string; 'runs-on': string | string[] }
type Workflow = {
  env?: Record<string, string>
  jobs: Record<string, Job>
  concurrency: { group: string; 'cancel-in-progress': string }
}
const ci = Bun.YAML.parse(read('.github/workflows/ci.yml')) as Workflow
const release = Bun.YAML.parse(read('.github/workflows/release.yml')) as Workflow
const landing = Bun.YAML.parse(read('.github/workflows/landing.yml')) as Workflow
const gates = ['check:release', 'type-check', 'check:tests', 'test', 'check:bundle']

function errors(steps: Step[]): string[] {
  const failures: string[] = []
  if (steps.filter((step) => step.run === 'bun run build').length !== 1) {
    failures.push('Expected one workspace build')
  }
  if (
    steps.filter(
      (step) => step.uses === './.github/actions/setup-workspace' && step.with?.install !== 'false',
    ).length !== 1
  ) {
    failures.push('Expected one dependency install')
  }
  const build = steps.findIndex((step) => step.run === 'bun run build')
  for (const gate of gates) {
    const index = steps.findIndex((step) => step.run === `bun run ${gate}`)
    if (index <= build || steps[index]?.if || steps[index]?.['continue-on-error']) {
      failures.push(`Missing required gate after build: ${gate}`)
    }
  }
  const bundle = steps.findIndex((step) => step.run === 'bun run check:bundle')
  const rustTools = steps.findIndex(
    (step) =>
      step.uses === './.github/actions/setup-desktop' && step.with?.['build-native'] === 'false',
  )
  if (rustTools < 0 || rustTools >= bundle)
    failures.push('Missing Rust tools before desktop bundle')
  return failures
}

describe('CI minute budget contract', () => {
  test('routes trusted Linux jobs to the dedicated runner and fork CI to hosted runners', () => {
    for (const job of Object.values(ci.jobs)) {
      expect(job['runs-on']).toContain("github.event_name == 'pull_request'")
      expect(job['runs-on']).toContain(
        'github.event.pull_request.head.repo.full_name != github.repository',
      )
      expect(job['runs-on']).toContain('ubuntu-')
      expect(job['runs-on']).toContain('["self-hosted","Linux","X64","localix-linux"]')
    }
    for (const [name, job] of Object.entries(release.jobs)) {
      if (name === 'build-desktop') continue
      expect(job['runs-on']).toEqual(['self-hosted', 'Linux', 'X64', 'localix-linux'])
    }
    expect(landing.jobs.deploy['runs-on']).toEqual(['self-hosted', 'Linux', 'X64', 'localix-linux'])
  })

  test('keeps macOS packaging on its existing hosted runner', () => {
    const selector = release.jobs['build-desktop']['runs-on']
    expect(selector).toContain("matrix.name == 'linux-x64'")
    expect(selector).toContain('fromJSON(\'["self-hosted","Linux","X64","localix-linux"]\')')
    expect(selector).toContain('|| matrix.os')
    expect(read('.github/workflows/release.yml')).toContain(
      '{"os":"macos-15","name":"macos-arm64"}',
    )
  })

  test('shares pinned Node, Bun, dependencies, and Rust setup across workflows', () => {
    const workspace = Bun.YAML.parse(read('.github/actions/setup-workspace/action.yml')) as {
      runs: { steps: Step[] }
    }
    const desktop = Bun.YAML.parse(read('.github/actions/setup-desktop/action.yml')) as {
      runs: { steps: Step[] }
    }
    const bun = workspace.runs.steps.find((step) => step.uses?.startsWith('oven-sh/setup-bun@'))
    expect(bun?.with?.['no-cache']).toBe("${{ runner.environment == 'self-hosted' }}")
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
      for (const job of Object.values(workflow.jobs)) {
        expect(
          job.steps.filter((step) => step.uses === './.github/actions/setup-workspace'),
        ).toHaveLength(1)
      }
    }
  })

  test('invalidates task caches when the Node toolchain changes', () => {
    expect(JSON.parse(read('turbo.json')).globalDependencies).toContain('.nvmrc')
  })

  test('sets up bundle metadata tools independently of the parallel Rust job', () => {
    expect(ci.env?.RUST_TOOLCHAIN).toBe('1.96.1')
    const steps = ci.jobs.app.steps
    const setup = steps.find((step) => step.name === 'Setup desktop bundle tools')!
    expect(setup.with?.toolchain).toBe('${{ env.RUST_TOOLCHAIN }}')
    expect(errors(steps.filter((step) => step !== setup))).toContain(
      'Missing Rust tools before desktop bundle',
    )
    expect(errors([...steps.filter((step) => step !== setup), setup])).toContain(
      'Missing Rust tools before desktop bundle',
    )
    const desktop = Bun.YAML.parse(read('.github/actions/setup-desktop/action.yml'))
    expect(
      desktop.runs.steps.find((step: Step) => step.name === 'Install Linux build dependencies').if,
    ).toContain("inputs.build-native == 'true'")
    expect(desktop.runs.steps.find((step: Step) => step.name === 'Cache Rust compilation').if).toBe(
      "inputs.build-native == 'true'",
    )
  })

  test('gives checks, desktop releases, and website deployments distinct names', () => {
    expect(Bun.YAML.parse(read('.github/workflows/ci.yml')).name).toBe('Checks')
    expect(Bun.YAML.parse(read('.github/workflows/release.yml')).name).toBe('Desktop Release')
    expect(Bun.YAML.parse(read('.github/workflows/landing.yml')).name).toBe('Website Deploy')
  })

  test('runs every JavaScript gate with one install and build', () => {
    expect(errors(ci.jobs.app.steps)).toEqual([])
    expect(ci.jobs.app.steps.flatMap((step) => step.run?.match(/^bun run .+$/gmu) ?? [])).toEqual(
      ['build', ...gates].map((gate) => `bun run ${gate}`),
    )
    const builds = Object.values(ci.jobs).flatMap((job) =>
      job.steps.filter((step) => step.run === 'bun run build'),
    )
    expect(builds).toHaveLength(1)
  })

  test('release verification runs every gate CI runs, so the two cannot drift apart', () => {
    const verify = release.jobs.verify.steps.map((step) => step.run ?? '').join('\n')
    // `check:bundle` stages and starts the desktop bundle; the release legs smoke the packaged app
    // itself, which is the stronger check, so verification does not repeat it.
    for (const gate of gates.filter((gate) => gate !== 'check:bundle')) {
      expect(verify, `release verify is missing ${gate}`).toMatch(
        new RegExp(`^\\s*bun run ${gate.replace(':', ':')}$`, 'mu'),
      )
    }
    expect(
      verify
        .match(/^\s*bun run .+$/gmu)
        ?.map((line) => line.trim())
        .filter((line) => line !== 'bun run check:rust'),
    ).toEqual(
      ['build', ...gates.filter((gate) => gate !== 'check:bundle')].map(
        (gate) => `bun run ${gate}`,
      ),
    )
  })

  test('rejects a repeated build, missing test gate or optional test gate', () => {
    const steps = ci.jobs.app.steps
    expect(errors([...steps, { run: 'bun run build' }])).toContain('Expected one workspace build')
    expect(errors(steps.filter((step) => step.run !== 'bun run test'))).toContain(
      'Missing required gate after build: test',
    )
    expect(
      errors(
        steps.map((step) =>
          step.run === 'bun run test' ? { ...step, 'continue-on-error': true } : step,
        ),
      ),
    ).toContain('Missing required gate after build: test')
  })

  test('uses two jobs with secret scanning in JavaScript and change detection in Rust', () => {
    expect(Object.keys(ci.jobs)).toEqual(['app', 'desktop'])
    expect(ci.jobs.desktop.needs).toBeUndefined()
    expect(ci.jobs.desktop.if).toBeUndefined()
    expect(ci.jobs.desktop.steps.some((step) => step.name === 'Detect desktop changes')).toBe(true)
    const rustCheck = ci.jobs.desktop.steps.find((step) => step.run === 'bun run check:rust')
    expect(rustCheck?.if).toBe("steps.filter.outputs.rust == 'true'")
    expect(ci.jobs.app.steps[0]?.with?.['fetch-depth']).toBe(0)
    const scan = ci.jobs.app.steps.find((step) => step.name === 'Scan history for secrets')
    expect(scan?.run).toContain('--config .gitleaks.toml')
    expect(scan?.if).toBeUndefined()
    expect(ci.jobs.app.steps.indexOf(scan!)).toBeLessThan(
      ci.jobs.app.steps.findIndex((step) => step.run === 'bun run build'),
    )
  })

  test('cancels superseded pushes without cancelling a manual run', () => {
    expect(ci.concurrency.group).toBe('ci-${{ github.event_name }}-${{ github.ref }}')
    expect(ci.concurrency['cancel-in-progress']).toBe(
      "${{ github.event_name != 'workflow_dispatch' }}",
    )
  })

  test('cancels superseded landing pushes and PRs independently of manual deployments', () => {
    expect(landing.concurrency.group).toBe('landing-${{ github.event_name }}-${{ github.ref }}')
    expect(landing.concurrency['cancel-in-progress']).toBe(
      "${{ github.event_name == 'push' || github.event_name == 'pull_request' }}",
    )
  })

  test('release verification reuses the CI cache before building', () => {
    for (const job of [ci.jobs.app, release.jobs.verify]) {
      const restore = job.steps.findIndex((step) => step.name === 'Restore Turbo cache')
      const build = job.steps.findIndex((step) => step.run === 'bun run build')
      expect(restore).toBeGreaterThan(-1)
      expect(build).toBeGreaterThan(restore)
      expect(job.steps[restore]?.with?.['restore-keys']).toBe(
        "turbo-js-${{ runner.os }}-${{ hashFiles('bun.lock') }}-\nturbo-js-${{ runner.os }}-\n",
      )
      const save = job.steps.find((step) => step.name === 'Save Turbo cache')
      expect(save?.with?.key).toBe(job.steps[restore]?.with?.key)
      expect(save?.if).toContain('always()')
    }
    expect(release.jobs.verify.steps.some((step) => step.run === 'bun run test')).toBe(true)
  })
})
