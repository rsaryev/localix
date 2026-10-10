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
type Job = { steps: Step[]; needs?: string[]; if?: string }
type Workflow = {
  jobs: Record<string, Job>
  concurrency: { group: string; 'cancel-in-progress': string }
}
const ci = Bun.YAML.parse(read('.github/workflows/ci.yml')) as Workflow
const release = Bun.YAML.parse(read('.github/workflows/release.yml')) as Workflow
const gates = [
  'check:vendor',
  'check:public',
  'check:release',
  'check:architecture',
  'check:docs',
  'check:generated',
  'check:audit',
  'format:check',
  'lint',
  'check:deadcode',
  'check:plugins',
  'type-check',
  'check:tests',
  'test',
  'check:globals',
  'test:dropins',
  'check:bundle',
]

function errors(steps: Step[]): string[] {
  const failures: string[] = []
  if (steps.filter((step) => step.run === 'bun run build').length !== 1) {
    failures.push('Expected one workspace build')
  }
  if (steps.filter((step) => step.run?.includes('bun install --frozen-lockfile')).length !== 1) {
    failures.push('Expected one dependency install')
  }
  const build = steps.findIndex((step) => step.run === 'bun run build')
  for (const gate of gates) {
    const index = steps.findIndex((step) => step.run === `bun run ${gate}`)
    if (index <= build || steps[index]?.if || steps[index]?.['continue-on-error']) {
      failures.push(`Missing required gate after build: ${gate}`)
    }
  }
  return failures
}

describe('CI minute budget contract', () => {
  test('runs every JavaScript gate with one install and build', () => {
    expect(errors(ci.jobs.static.steps)).toEqual([])
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
  })

  test('rejects a repeated build, missing test gate or optional test gate', () => {
    const steps = ci.jobs.static.steps
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

  test('keeps JavaScript, Rust, and the secret scan required by the aggregate status', () => {
    expect(ci.jobs.ci.needs).toEqual(['changes', 'static', 'rust', 'secrets'])
    expect(ci.jobs.ci.if).toBe('always()')
    expect(ci.jobs.rust.if).toBe("needs.changes.outputs.rust == 'true'")
    expect(ci.jobs.rust.steps.some((step) => step.run === 'bun run check:rust')).toBe(true)
    expect(ci.jobs.secrets.if).toBeUndefined()
    expect(ci.jobs.secrets.steps[0]?.with?.['fetch-depth']).toBe(0)
    expect(ci.jobs.secrets.steps.at(-1)?.run).toContain('--config .gitleaks.toml')
  })

  test('cancels superseded pushes without cancelling a manual run', () => {
    expect(ci.concurrency.group).toBe('ci-${{ github.event_name }}-${{ github.ref }}')
    expect(ci.concurrency['cancel-in-progress']).toBe(
      "${{ github.event_name != 'workflow_dispatch' }}",
    )
  })

  test('release verification reuses the CI cache before building', () => {
    for (const job of [ci.jobs.static, release.jobs.verify]) {
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
    expect(release.jobs.verify.steps.some((step) => step.run?.includes('bun run test\n'))).toBe(
      true,
    )
  })
})
