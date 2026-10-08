/**
 * A detected dev-server URL opens the preview by push — and does so exactly once, only
 * where a preview exists to open.
 */
import { describe, expect, test } from 'bun:test'

import type { RunProfile } from '../../../agent-core/run-shape'
import type { OpenPreviewCoreInput } from '../../../agent-core/tools/preview/open-preview'
import type { SessionRecord } from '../../repository'
import { createPreviewTargetRegistry } from '../preview-target-registry'
import type { RunnerDeps } from '../agent-runner-types'
import { buildPreviewTargetRecorder } from './preview-auto-open'

const session = { id: 's1', sessionKind: 'chat' } as SessionRecord
const previewing = { toolExposure: { browser: 'direct' } } as unknown as RunProfile
const blind = { toolExposure: {} } as unknown as RunProfile

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

function harness(profile: RunProfile, outcomes: boolean[] = [true]) {
  const targets = createPreviewTargetRegistry()
  const opens: OpenPreviewCoreInput[] = []
  const deps = {
    previewTargets: targets,
    previewControl: {},
    streamRegistry: { publish: () => {} },
  } as unknown as RunnerDeps
  const record = buildPreviewTargetRecorder({
    deps,
    userId: 'u1',
    session,
    defaultCwd: '/tmp',
    agentProfile: profile,
    open: async (input) => {
      opens.push(input)
      const ok = outcomes.shift() ?? true
      return ok
        ? ({
            ok: true,
            url: input.url ?? '',
            previewId: 'p',
            title: 't',
            version: 1,
            frameBlocked: false,
            autoServed: false,
            content: '',
          } as never)
        : { ok: false, content: 'not listening yet' }
    },
    delay: async () => {},
  })
  return { record: record!, targets, opens }
}

describe('buildPreviewTargetRecorder', () => {
  test('a detected URL opens the preview and is remembered as opened', async () => {
    const h = harness(previewing)
    h.record('http://localhost:4173')
    await settle()
    expect(h.opens.map((o) => o.url)).toEqual(['http://localhost:4173'])
    expect(h.targets.get('u1', 's1')?.opened).toBe(true)
  })

  test('the same origin re-detected does not reopen — the terminal-tab dedup', async () => {
    const h = harness(previewing)
    h.record('http://localhost:4173')
    await settle()
    h.record('http://localhost:4173/')
    await settle()
    expect(h.opens).toHaveLength(1)
  })

  test('a DIFFERENT server opens again', async () => {
    const h = harness(previewing)
    h.record('http://localhost:4173')
    await settle()
    h.record('http://localhost:3000')
    await settle()
    expect(h.opens.map((o) => o.url)).toEqual(['http://localhost:4173', 'http://localhost:3000'])
  })

  test('a banner that beats the socket is retried once, then marked opened', async () => {
    const h = harness(previewing, [false, true])
    h.record('http://localhost:4173')
    await settle()
    expect(h.opens).toHaveLength(2)
    expect(h.targets.get('u1', 's1')?.opened).toBe(true)
  })

  test('two failures leave the target UNopened, for the lazy drive path to pick up', async () => {
    const h = harness(previewing, [false, false])
    h.record('http://localhost:4173')
    await settle()
    expect(h.opens).toHaveLength(2)
    expect(h.targets.get('u1', 's1')?.opened).toBe(false)
  })

  test('a run whose profile has no preview tool records the target and opens nothing', async () => {
    // A delegated task run or an automation: nothing is watching, and the orchestrator that
    // IS watching opens its own.
    const h = harness(blind)
    h.record('http://localhost:4173')
    await settle()
    expect(h.opens).toHaveLength(0)
    expect(h.targets.get('u1', 's1')?.url).toBe('http://localhost:4173')
  })

  /**
   * The pane's "Wake preview" reruns the remembered command. Only the job that printed the
   * banner knows it, so a detected preview that dropped it could offer nothing but a dead
   * reload — whatever the server was started with.
   */
  test('carries the command that printed the banner into the opened preview', async () => {
    const h = harness(previewing)
    h.record('http://localhost:4173', 'npm run dev', '/work/project/frontend')
    await settle()

    expect(h.opens[0]?.start_command).toBe('npm run dev')
    expect(h.opens[0]?.start_cwd).toBe('/work/project/frontend')
    expect(h.targets.get('u1', 's1')?.startCwd).toBe('/work/project/frontend')
    expect(h.targets.get('u1', 's1')?.startCommand).toBe('npm run dev')
  })

  test('a re-detected same server keeps the command a later banner line omits', async () => {
    const h = harness(previewing)
    h.record('http://localhost:4173', 'node server.js')
    await settle()
    h.record('http://localhost:4173/')
    await settle()

    expect(h.targets.get('u1', 's1')?.startCommand).toBe('node server.js')
  })

  test('no target registry at all means no recorder', () => {
    const record = buildPreviewTargetRecorder({
      deps: {} as RunnerDeps,
      userId: 'u1',
      session,
      defaultCwd: '/tmp',
      agentProfile: previewing,
    })
    expect(record).toBeUndefined()
  })
})

test('a same-origin launch from a new directory republishes the updated recipe', async () => {
  const h = harness(previewing)
  h.record('http://localhost:4173', 'bun dev', '/work/first')
  await settle()
  h.record('http://localhost:4173', 'bun dev', '/work/second')
  await settle()
  expect(h.opens).toHaveLength(2)
  expect(h.opens[1]?.start_cwd).toBe('/work/second')
})
