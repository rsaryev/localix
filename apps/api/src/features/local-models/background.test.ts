import { describe, expect, test } from 'bun:test'
import { createBackgroundDownloads } from './background'
import type { InstallJob, LocalModelSpec } from './contracts'

const spec = {
  id: 'ggml-org/embeddinggemma-2-GGUF:Q8_0',
  label: 'EmbeddingGemma 2',
} as LocalModelSpec

/** A queue that records what was started and paused; jobs stay until the test settles them. */
function harness() {
  const installed = new Set<string>()
  const jobs = new Map<string, InstallJob>()
  const started: string[] = []
  const paused: string[] = []
  let wanted = true
  const background = createBackgroundDownloads({
    isInstalled: (id) => installed.has(id),
    jobs: () => [...jobs.values()],
    start: async (s, { background: quiet }) => {
      started.push(s.id)
      jobs.set(s.id, {
        modelId: s.id,
        label: s.label,
        background: quiet,
        phase: 'downloading',
        received: 0,
        total: 1,
        rate: null,
        error: null,
      })
    },
    pause: async (id) => {
      paused.push(id)
      jobs.delete(id)
    },
  })
  background.declare('semantic-search', () => (wanted ? [spec] : []))
  return {
    background,
    installed,
    jobs,
    started,
    paused,
    want: (on: boolean) => {
      wanted = on
      background.reconcile()
    },
  }
}

describe('background downloads', () => {
  test('a wanted model that is missing downloads once, quietly', () => {
    const h = harness()
    h.background.reconcile()
    expect(h.started).toEqual([spec.id])
    expect(h.jobs.get(spec.id)?.background).toBe(true)
  })

  test('a removed model is fetched again while it is wanted', () => {
    const h = harness()
    h.jobs.clear()
    h.installed.add(spec.id)
    h.background.reconcile()
    h.installed.delete(spec.id)
    h.background.reconcile()
    expect(h.started).toEqual([spec.id, spec.id])
  })

  test('no longer wanted, its background download pauses; a person’s own download does not', () => {
    const h = harness()
    h.want(false)
    expect(h.paused).toEqual([spec.id])
    h.jobs.set(spec.id, {
      modelId: spec.id,
      label: spec.label,
      background: false,
      phase: 'downloading',
      received: 0,
      total: 1,
      rate: null,
      error: null,
    })
    h.background.reconcile()
    expect(h.paused).toEqual([spec.id])
  })

  test('a cancelled download stays cancelled until what is wanted changes', () => {
    const h = harness()
    h.background.decline(spec.id)
    h.jobs.clear()
    h.background.reconcile()
    expect(h.started).toEqual([spec.id])
    h.want(false)
    h.want(true)
    expect(h.started).toEqual([spec.id, spec.id])
  })

  test('a failed download waits for a retry', () => {
    const h = harness()
    h.jobs.set(spec.id, { ...h.jobs.get(spec.id)!, phase: 'failed', error: 'offline' })
    h.background.reconcile()
    expect(h.started).toEqual([spec.id])
    h.background.reconcile({ retry: true })
    expect(h.started).toEqual([spec.id, spec.id])
  })
})
