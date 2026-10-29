import { afterEach, describe, expect, test } from 'bun:test'

import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'

import { setMiniAppSources } from './miniAppAttribution'
import { createMiniAppToast, type AttributableToast } from './miniAppToast'

const base = 'http://127.0.0.1:43110/rpc/mini-apps/acme/ui/'
const miniAppFrame = `onSelect@${base}entry.js?v=r1:12:88`
const hostFrame = 'error@tauri://localhost/assets/index-a1b2c3.js:9120:40'

type Call = { method: string; message?: string; options?: Record<string, unknown> }

function recordingHost(calls: Call[]): AttributableToast {
  const method =
    (name: string) =>
    (message: string, options?: object): string => {
      calls.push({ method: name, message, options: options as Record<string, unknown> })
      return name
    }
  return Object.assign(method('default'), {
    success: method('success'),
    error: method('error'),
    info: method('info'),
    warning: method('warning'),
    message: method('message'),
    problems: (_report: ProblemReport, options: object) => {
      calls.push({ method: 'problems', options: options as Record<string, unknown> })
      return 'row'
    },
    problemsCleared: () => {
      calls.push({ method: 'problemsCleared' })
    },
  })
}

const report: ProblemReport = { subject: { label: 'orders.sql' }, problems: [{ message: 'x' }] }

afterEach(() => setMiniAppSources([], new Map()))

describe('the toast the host lends mini apps', () => {
  test("labels a mini app's row with its display name and keeps the rest of the options", () => {
    setMiniAppSources([{ miniAppName: 'acme', base }], new Map([['acme', 'Acme']]))
    const calls: Call[] = []
    const toast = createMiniAppToast(recordingHost(calls), () => `${hostFrame}\n${miniAppFrame}`)
    toast.error('Could not connect', { description: 'refused' })
    toast('Saved')
    expect(calls).toEqual([
      {
        method: 'error',
        message: 'Could not connect',
        options: { description: 'refused', source: 'Acme' },
      },
      { method: 'default', message: 'Saved', options: { source: 'Acme' } },
    ])
  })

  test('a call nothing can attribute is published exactly as before', () => {
    const calls: Call[] = []
    const toast = createMiniAppToast(recordingHost(calls), () => hostFrame)
    const options = { description: 'refused' }
    toast.warning('Slow', options)
    toast.info('Plain')
    expect(calls[0]?.options).toEqual(options)
    expect(calls[1]?.options).toBeUndefined()
  })

  // Positive control for the spoofing rule: the name is the host's to give.
  test('a mini app cannot file its row under a name it claims', () => {
    setMiniAppSources([{ miniAppName: 'acme', base }], new Map([['acme', 'Acme']]))
    const calls: Call[] = []
    const claimed = { source: 'Sync' } as unknown as Parameters<typeof toast.error>[1]
    let toast = createMiniAppToast(recordingHost(calls), () => miniAppFrame)
    toast.error('a', claimed)
    toast = createMiniAppToast(recordingHost(calls), () => hostFrame)
    toast.error('b', claimed)
    expect(calls.map((call) => call.options?.source)).toEqual(['Acme', undefined])
  })

  test('a problem report is labelled by attribution, else by its scope', () => {
    setMiniAppSources([{ miniAppName: 'acme', base }], new Map([['acme', 'Acme']]))
    const calls: Call[] = []
    createMiniAppToast(recordingHost(calls), () => miniAppFrame).problems(report, { scope: 'x' })
    // From the shared hook's effect: no mini app frame, so the scope (the mini app id) names it.
    createMiniAppToast(recordingHost(calls), () => hostFrame).problems(report, { scope: 'acme' })
    createMiniAppToast(recordingHost(calls), () => hostFrame).problems(report, { scope: 'notes' })
    expect(calls.map((call) => call.options?.source)).toEqual(['Acme', 'Acme', 'notes'])
  })

  test('settling a subject passes straight through', () => {
    const calls: Call[] = []
    createMiniAppToast(recordingHost(calls), () => hostFrame).problemsCleared(report, 'acme')
    expect(calls).toEqual([{ method: 'problemsCleared' }])
  })
})
