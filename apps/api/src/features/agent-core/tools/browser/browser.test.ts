/**
 * browser tool boundary. Fakes the `send` capability to assert the tool's two
 * jobs: (1) building a clean PreviewCommand from the schema's input — interactions only as
 * `steps` (no undefined keys leak),
 * and (2) formatting the reply — supersedeKey on snapshot-bearing results, image
 * content-parts for screenshots (with an oversize fallback), and error passthrough.
 */
import { describe, expect, it, test } from 'bun:test'
import { textEncoderByteLength } from '@localixai/agent'
import type { CallClass } from '@localixai/agent/agents'
import { createBrowserTool, type BrowserToolDeps } from './browser'
import { BROWSER_DESCRIPTION, type BrowserInput } from './browser-input'
import { liftTrailingScreenshot } from './browser-lift'
import type { PreviewCommand, PreviewSendOutcome } from '../preview/preview-control'
import type { OpenPreviewCoreInput, OpenPreviewCoreResult } from '../preview/open-preview'

describe('browser model contract', () => {
  test('says how the tool behaves within a bounded description', () => {
    expect(textEncoderByteLength(BROWSER_DESCRIPTION)).toBeLessThan(600)
    for (const phrase of ['relay-only', 'preview_id', 'dialogs', 're-snapshot', 'file_path']) {
      expect(BROWSER_DESCRIPTION).toContain(phrase)
    }
  })

  test('leaves the verification discipline to the prompt, which states it once', () => {
    // "What counts as evidence" used to be written here AND in "# Execution discipline"; both
    // copies rode every request. The prompt owns it (`previewVerificationLine`).
    for (const phrase of ['unverified', 'retry', 'delegated']) {
      expect(BROWSER_DESCRIPTION.toLowerCase()).not.toContain(phrase)
    }
  })
})

test('history uses one app-wide relay without a tab target and returns bounded results', async () => {
  const { tool, sent } = toolWith({
    ok: true,
    result: { action: 'history', value: '{"total":1,"entries":[{"url":"https://example.com/"}]}' },
  })
  const result = await tool.execute('history-1', {
    action: 'history',
    history_operation: 'search',
    history_query: 'example',
  })
  expect(sent).toEqual([
    {
      action: 'history',
      historyOperation: 'search',
      historyQuery: 'example',
    },
  ])
  expect(result.content).toContain('https://example.com/')
  expect(result.supersedeKey).toBe('browser:history')
})

describe('browser classify judges what will run', () => {
  // The gate used to read only `action`: a screenshot carrying a click prelude passed as a read
  // while execute ran the click first.
  const { tool } = toolWith({ ok: true, result: { action: 'screenshot' } })
  const classify = (input: unknown) => tool.classify?.(input as BrowserInput)

  test.each([
    [{ action: 'viewport', viewport: 'mobile' }, { effect: 'view' }],
    [{ action: 'open', url: 'http://localhost:5173' }, { effect: 'view' }],
    [{ action: 'close' }, { effect: 'view' }],
    [{ action: 'snapshot' }, { effect: 'view' }],
    [{ action: 'take_screenshot' }, { effect: 'view' }],
    [{ action: 'take_screenshot', steps: [] }, { effect: 'view' }],
    [{ action: 'console' }, { effect: 'view' }],
    [{ action: 'evaluate', expression: '1' }, { effect: 'external' }],
    [{ action: 'steps', steps: [{ action: 'click', ref: 'e1' }] }, { effect: 'external' }],
    [{ action: 'history', history_operation: 'list' }, { effect: 'read' }],
    [{ action: 'history', history_operation: 'search' }, { effect: 'read' }],
    [{ action: 'history', history_operation: 'open' }, { effect: 'view' }],
    [
      { action: 'history', history_operation: 'remove' },
      { effect: 'host', irreversible: true },
    ],
    [
      { action: 'history', history_operation: 'clear' },
      { effect: 'host', irreversible: true },
    ],
    [{ action: 'history' }, { effect: 'external' }],
    [{ action: 'unknown' }, { effect: 'external' }],
    [{}, { effect: 'external' }],
    // Inferred from the payload, as execute infers it.
    [{ expression: 'document.title' }, { effect: 'external' }],
    [{ url: 'http://localhost:5173' }, { effect: 'view' }],
  ] satisfies [unknown, CallClass][])('%j', (input, expected) => {
    expect(classify(input)).toEqual(expected)
  })

  test('a screenshot carrying steps is the batch it executes', () => {
    expect(
      classify({ action: 'take_screenshot', steps: [{ action: 'click', ref: 'e1' }] }),
    ).toEqual({ effect: 'external' })
  })

  test('the lifted form of an act-then-look batch is external', () => {
    const lifted = liftTrailingScreenshot({
      action: 'steps',
      steps: [{ action: 'type', ref: 'e2', text: 'Ada' }, { action: 'take_screenshot' }],
    }) as { action: string }
    expect(lifted.action).toBe('take_screenshot')
    expect(classify(lifted)).toEqual({ effect: 'external' })
  })

  test('steps on any other observing action are judged as the batch too', () => {
    for (const action of ['snapshot', 'console', 'viewport', 'open', 'close']) {
      const withSteps = { action, steps: [{ action: 'evaluate', expression: '1' }] }
      expect(classify(withSteps)).toEqual({ effect: 'external' })
      expect(classify({ action })).toEqual({ effect: 'view' })
    }
  })

  test('steps on a history call are judged as the batch, not as the history operation', () => {
    const call = { action: 'history', history_operation: 'list', steps: [{ action: 'click' }] }
    expect(classify(call)).toEqual({ effect: 'external' })
  })
})

const OPEN_OK: OpenPreviewCoreResult = {
  ok: true,
  url: 'http://localhost:5173/',
  previewId: 'http://localhost:5173',
  title: 'localhost:5173',
  version: 1,
  frameBlocked: false,
  autoServed: false,
  content: 'Opened preview: http://localhost:5173/',
}

function toolWith(outcome: PreviewSendOutcome) {
  const sent: PreviewCommand[] = []
  let closed = 0
  const tool = createBrowserTool({
    async send(command) {
      sent.push(command)
      return outcome
    },
    async openPreview() {
      return OPEN_OK
    },
    closePreview() {
      closed += 1
    },
  })
  return { tool, sent, closed: () => closed }
}

/** Richer harness: tracks open/record calls + a mutable target, with a send queue. */
function harness(opts: {
  sendOutcomes?: PreviewSendOutcome[]
  openResult?: OpenPreviewCoreResult
}) {
  const opens: OpenPreviewCoreInput[] = []
  const sends: PreviewCommand[] = []
  let closed = 0
  const queue = [
    ...(opts.sendOutcomes ?? [
      {
        ok: true,
        result: {
          action: 'snapshot',
          snapshot: {
            url: 'http://x',
            title: 'X',
            tree: '- a',
            stats: { nodes: 1, interactive: 0, chars: 1 },
          },
        },
      },
    ]),
  ]
  const openResult = opts.openResult ?? OPEN_OK
  const deps: BrowserToolDeps = {
    send: async (command) => {
      sends.push(command)
      return (
        queue.shift() ?? {
          ok: true,
          result: {
            action: 'snapshot',
            snapshot: {
              url: 'http://x',
              title: 'X',
              tree: '- a',
              stats: { nodes: 1, interactive: 0, chars: 1 },
            },
          },
        }
      )
    },
    openPreview: async (input) => {
      opens.push(input)
      return openResult
    },
    closePreview: () => {
      closed += 1
    },
  }
  return { deps, opens, sends, closedCount: () => closed }
}

/** The one-step batch most drive cases need: interactions exist only as steps. */
const CLICK_E1: BrowserInput = { action: 'steps', steps: [{ action: 'click', ref: 'e1' }] }

const snapshotResult: PreviewSendOutcome = {
  ok: true,
  result: {
    action: 'snapshot',
    snapshot: {
      url: 'http://x',
      title: 'X',
      tree: '- button "Go" [ref=e1]',
      stats: { nodes: 1, interactive: 1, chars: 10 },
    },
  },
}

describe('browser tool', () => {
  test('viewport drives the selected preview and reports confirmed dimensions', async () => {
    const { tool, sent } = toolWith({
      ok: true,
      result: { action: 'viewport', previewId: 'preview-a', viewport: { width: 375, height: 667 } },
    })
    const result = await tool.execute('resize', {
      action: 'viewport',
      preview_id: 'preview-a',
      viewport: { width: 375, height: 667 },
    })
    expect(sent).toEqual([
      { action: 'viewport', previewId: 'preview-a', viewport: { width: 375, height: 667 } },
    ])
    expect(result.details?.viewport).toEqual({ width: 375, height: 667 })
    expect(result.content).toContain('375')
    expect(result.content).toContain('touch is not emulated')
    await tool.execute('fill', { action: 'viewport', viewport: null })
    expect(sent[1]?.viewport).toBeNull()
  })

  test('viewport without confirmed dimensions is not a success', async () => {
    const { tool } = toolWith({ ok: true, result: { action: 'viewport' } })
    expect((await tool.execute('resize', { action: 'viewport', viewport: null })).isError).toBe(
      true,
    )
  })

  test('a diagnostic timeout must not reopen and replay an interaction', async () => {
    const h = harness({
      sendOutcomes: [
        { ok: false, notEngaged: true, errorCode: 'timeout', error: 'The action may have run.' },
      ],
    })
    const result = await createBrowserTool(h.deps).execute('click', {
      action: 'steps',
      steps: [{ action: 'click', ref: 'e1' }],
    })
    expect(result.isError).toBe(true)
    expect(result.details?.errorCode).toBe('timeout')
    expect(h.sends).toHaveLength(1)
    expect(h.opens).toHaveLength(0)
  })
  it('description matches the relay-only reality — no removed headless/external-browser backend', () => {
    const { tool } = toolWith(snapshotResult)
    // The external headless-browser backend was removed; browser is RELAY-ONLY.
    // Guard against the stale claim that it "works on … a headless browser showing an external site".
    expect(tool.description.toLowerCase()).not.toContain('headless')
    expect(tool.description.toLowerCase()).not.toContain('external site')
    expect(tool.description.toLowerCase()).toContain('relay-only')
  })

  it('normalizes the singular action "step" to "steps" (models reach for it)', () => {
    const { tool } = toolWith(snapshotResult)
    const parsed = tool.inputSchema.safeParse({
      action: 'step',
      steps: [{ action: 'press', key: 'ArrowUp' }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.action).toBe('steps')
  })

  it('defaults to the cheap diff for a batch (no snapshotAfter forwarded)', async () => {
    const { tool, sent } = toolWith({
      ok: true,
      result: { action: 'steps', note: 'clicked', diff: '+ x' },
    })
    await tool.execute('t1', { action: 'steps', steps: [{ action: 'click', ref: 'e1' }] })
    expect(sent).toHaveLength(1)
    // no snapshotAfter → probe returns a diff
    expect(sent[0]).toEqual({ action: 'steps', steps: [{ action: 'click', ref: 'e1' }] })
  })

  it('forwards an explicit snapshot_after:true for the full fresh tree', async () => {
    const { tool, sent } = toolWith(snapshotResult)
    await tool.execute('t1b', {
      action: 'steps',
      steps: [{ action: 'click', ref: 'e1' }],
      snapshot_after: true,
    })
    expect(sent[0]).toEqual({
      action: 'steps',
      steps: [{ action: 'click', ref: 'e1' }],
      snapshotAfter: true,
    })
  })

  it('forwards a keys[] sequence and snapshot_after but no undefined top-level keys', async () => {
    const { tool, sent } = toolWith(snapshotResult)
    await tool.execute('t2', {
      action: 'steps',
      steps: [{ action: 'press', keys: ['ArrowUp', 'ArrowRight'] }],
      snapshot_after: true,
      preview_id: undefined,
    })
    expect(Object.keys(sent[0]).sort()).toEqual(['action', 'snapshotAfter', 'steps'])
    expect(sent[0].steps?.[0]).toMatchObject({ action: 'press', keys: ['ArrowUp', 'ArrowRight'] })
  })

  it('marks snapshot results with supersedeKey "preview"', async () => {
    const { tool } = toolWith(snapshotResult)
    const res = await tool.execute('t3', { action: 'snapshot' })
    expect(res.supersedeKey).toBe('browser')
    expect(res.content).toContain('[ref=e1]')
  })

  it('supersedes an action result only when it carries a fresh snapshot', async () => {
    const withSnap = await toolWith({
      ok: true,
      result: {
        action: 'steps',
        note: 'clicked',
        snapshot: snapshotResult.ok ? snapshotResult.result.snapshot : undefined,
      },
    }).tool.execute('t4', { ...CLICK_E1, snapshot_after: true })
    expect(withSnap.supersedeKey).toBe('browser')

    const noSnap = await toolWith({
      ok: true,
      result: { action: 'steps', note: 'clicked', diff: '+ x' },
    }).tool.execute('t5', CLICK_E1)
    expect(noSnap.supersedeKey).toBeUndefined()
  })

  it('returns an image content-part for a screenshot, with an oversize text fallback', async () => {
    const small: PreviewSendOutcome = {
      ok: true,
      result: {
        action: 'screenshot',
        target: 'button',
        rect: { x: 0, y: 0, width: 4, height: 4 },
        image: { data: 'AAAA', mediaType: 'image/jpeg', width: 4, height: 4 },
      },
    }
    const okRes = await toolWith(small).tool.execute('t6', { action: 'take_screenshot', ref: 'e1' })
    expect(okRes.contentParts?.[0]).toMatchObject({ type: 'image', mediaType: 'image/jpeg' })

    const huge: PreviewSendOutcome = {
      ok: true,
      result: {
        action: 'screenshot',
        target: 'button',
        rect: null,
        image: { data: 'x'.repeat(8 * 1024 * 1024), mediaType: 'image/jpeg', width: 9, height: 9 },
      },
    }
    const bigRes = await toolWith(huge).tool.execute('t7', { action: 'take_screenshot', ref: 'e1' })
    expect(bigRes.contentParts).toBeUndefined()
    expect(bigRes.content).toContain('too large')
  })

  it('passes a backend error through as a tool error', async () => {
    const res = await toolWith({
      ok: false,
      error: 'No open preview',
      errorCode: 'failed',
    }).tool.execute('t8', { action: 'snapshot' })
    expect(res.isError).toBe(true)
    expect(res.content).toBe('No open preview')
  })

  it("folds a self-healed failure's fresh snapshot into the error (no extra re-snapshot call)", async () => {
    const recovered: PreviewSendOutcome = {
      ok: false,
      errorCode: 'not_found',
      error:
        'ref "e8" not found — the page changed. A fresh snapshot is attached below; retarget using its [ref=eN] handles.',
      result: {
        action: 'steps',
        snapshot: {
          url: 'http://x',
          title: 'X',
          tree: '- button "Retry" [ref=e2]',
          stats: { nodes: 1, interactive: 1, chars: 12 },
        },
      },
    }
    const res = await toolWith(recovered).tool.execute('t8b', {
      action: 'steps',
      steps: [{ action: 'click', ref: 'e8' }],
    })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('not found')
    expect(res.content).toContain('[ref=e2]') // fresh refs ride along in the SAME turn
    expect(res.supersedeKey).toBe('browser')
    expect(res.details?.snapshot?.tree).toContain('Retry')
  })

  it('a plain (snapshot-less) failure stays a bare error', async () => {
    const res = await toolWith({ ok: false, error: 'boom', errorCode: 'failed' }).tool.execute(
      't8c',
      CLICK_E1,
    )
    expect(res.isError).toBe(true)
    expect(res.content).toBe('boom')
    expect(res.supersedeKey).toBeUndefined()
  })

  it('prepends a reload notice when the probe reports the page reloaded between commands', async () => {
    const reloaded: PreviewSendOutcome = {
      ok: true,
      result: {
        action: 'snapshot',
        reloaded: true,
        snapshot: {
          url: 'http://x',
          title: 'X',
          tree: '- button "Go" [ref=e1]',
          stats: { nodes: 1, interactive: 1, chars: 10 },
        },
      },
    }
    const res = await toolWith(reloaded).tool.execute('rl1', { action: 'snapshot' })
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('page reloaded')
    expect(res.content).toContain('[ref=e1]') // still shows the (fresh) page
  })

  it('renders a "failed to load" warning when a snapshot reports failed subresources', async () => {
    const withFailures: PreviewSendOutcome = {
      ok: true,
      result: {
        action: 'snapshot',
        snapshot: {
          url: 'http://x',
          title: 'X',
          tree: '- button "Theme" [ref=e1]',
          stats: { nodes: 1, interactive: 1, chars: 10 },
          failedResources: ['stylesheet assets/style.css', 'script app.js'],
        },
      },
    }
    const res = await toolWith(withFailures).tool.execute('fr1', { action: 'snapshot' })
    expect(res.content).toContain('failed to load')
    expect(res.content).toContain('assets/style.css')
    expect(res.content).toContain('app.js')
  })

  it('appends a ⚠ block for errors captured DURING a drive action (recentErrors)', async () => {
    const withErr: PreviewSendOutcome = {
      ok: true,
      result: {
        action: 'steps',
        note: 'clicked button "Save"',
        diff: '(no visible change)',
        recentErrors: [
          'TypeError: cannot read value of null',
          '[dialog] alert("Saved!") auto-dismissed',
        ],
      },
    }
    const res = await toolWith(withErr).tool.execute('we1', CLICK_E1)
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('⚠')
    expect(res.content).toContain('during this action')
    expect(res.content).toContain('TypeError: cannot read value of null')
    expect(res.content).toContain('[dialog] alert("Saved!") auto-dismissed')
    expect(res.content).toContain('clicked button "Save"') // normal action content stays
  })

  it('renders a "newly failed to load" warning on a diff-only drive result', async () => {
    const withFail: PreviewSendOutcome = {
      ok: true,
      result: {
        action: 'steps',
        note: 'clicked',
        diff: '+ x',
        failedResources: ['stylesheet assets/theme.css'],
      },
    }
    const res = await toolWith(withFail).tool.execute('wf1', CLICK_E1)
    expect(res.content).toContain('newly failed to load')
    expect(res.content).toContain('assets/theme.css')
  })

  it('a clean drive action carries no ⚠ block', async () => {
    const clean: PreviewSendOutcome = {
      ok: true,
      result: { action: 'steps', note: 'clicked', diff: '+ ok' },
    }
    const res = await toolWith(clean).tool.execute('wc1', CLICK_E1)
    expect(res.content).not.toContain('⚠')
  })

  it('the description states errors/dialogs during an action are auto-attached', () => {
    const { tool } = toolWith(snapshotResult)
    expect(tool.description).toContain('auto-dismissed')
    expect(tool.description.toLowerCase()).toContain('during an action')
  })

  it('infers action="evaluate" from a lone `expression` (no hard schema reject)', async () => {
    const { tool, sent } = toolWith({ ok: true, result: { action: 'evaluate', value: 'true' } })
    const res = await tool.execute('inf1', { expression: 'typeof window.soundwaveToggle' })
    expect(res.isError).toBeFalsy()
    expect(sent[0]).toEqual({ action: 'evaluate', expression: 'typeof window.soundwaveToggle' })
    expect(res.content).toContain('inferred action="evaluate"')
    expect(res.content).toContain('true')
  })

  it('infers action="steps" from a lone steps batch', async () => {
    const { tool, sent } = toolWith({ ok: true, result: { action: 'steps', note: 'typed' } })
    const res = await tool.execute('inf2', { steps: [{ action: 'type', ref: 'e3', text: 'Ada' }] })
    expect(sent[0]).toMatchObject({ action: 'steps', steps: [{ action: 'type', ref: 'e3' }] })
    expect(res.content).toContain('inferred action="steps"')
  })

  it('a bare ref is not inferred as a click: it names no action, so the fix-it names steps', async () => {
    // The flat contract used to read `{ref:"e5"}` as a click. A ref is screenshot's target and a
    // step's, so guessing a click would run an interaction the call never asked for.
    const { tool, sent } = toolWith(snapshotResult)
    const res = await tool.execute('inf3', { ref: 'e5' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('{"action":"steps","steps":[{"action":"click","ref":"e3"}]}')
    expect(sent).toHaveLength(0)
  })

  it('still reports a fix-it when the action is genuinely ambiguous (no signal field)', async () => {
    const { tool, sent } = toolWith(snapshotResult)
    const res = await tool.execute('inf4', {})
    expect(res.isError).toBe(true)
    expect(res.content).toContain('needs an "action"')
    expect(sent).toHaveLength(0)
  })

  it('the dispatch path refuses a flat interaction with the steps call that replaces it', () => {
    // The runtime runs `prepareArguments` before it validates; a throw there becomes the call's
    // error result, so this message is what the model reads instead of a bare enum refusal.
    const { tool } = toolWith(snapshotResult)
    expect(() => tool.prepareArguments?.({ action: 'type', ref: 'e3', text: 'Ada' })).toThrow(
      '{"action":"steps","steps":[{"action":"type","ref":"e3","text":"Ada"}]}',
    )
  })

  it('normalizes ref forms the model copies from the tree ("[e3]", "ref=e3", "[ref=e3]") to "e3"', async () => {
    for (const raw of ['[e3]', 'ref=e3', '[ref=e3]', ' e3 ', 'E3']) {
      const { tool, sent } = toolWith(snapshotResult)
      await tool.execute('r', { action: 'take_screenshot', ref: raw })
      expect(sent[0].ref).toBe('e3')
      // The tool's `take_screenshot` is the probe protocol's `screenshot` — one seam.
      expect(sent[0].action).toBe('screenshot')
    }
  })

  it('normalizes refs inside a steps[] batch', async () => {
    const { tool, sent } = toolWith({ ok: true, result: { action: 'steps', note: 'done' } })
    await tool.execute('s', {
      action: 'steps',
      steps: [
        { action: 'type', ref: '[e2]', text: 'hi' },
        { action: 'click', ref: 'ref=e5' },
      ],
    })
    expect(sent[0].steps).toEqual([
      { action: 'type', ref: 'e2', text: 'hi' },
      { action: 'click', ref: 'e5' },
    ])
  })

  it('accepts read actions (evaluate/console) in a steps batch and forwards the expression (act-then-verify)', async () => {
    const { tool, sent } = toolWith({
      ok: true,
      result: { action: 'steps', note: 'clicked → evaluate → dark' },
    })
    // Was hard-rejected before: STEP_ACTIONS excluded evaluate/console.
    const parsed = tool.inputSchema.safeParse({
      action: 'steps',
      steps: [
        { action: 'click', ref: 'e9' },
        { action: 'evaluate', expression: "document.documentElement.getAttribute('data-theme')" },
        { action: 'console' },
      ],
    })
    expect(parsed.success).toBe(true)

    await tool.execute('sr1', {
      action: 'steps',
      steps: [
        { action: 'click', ref: 'e9' },
        { action: 'evaluate', expression: "document.documentElement.getAttribute('data-theme')" },
      ],
    })
    expect(sent[0].action).toBe('steps')
    expect(sent[0].steps?.[0]).toMatchObject({ action: 'click', ref: 'e9' })
    // The evaluate step's expression reaches the probe verbatim.
    expect(sent[0].steps?.[1]).toMatchObject({
      action: 'evaluate',
      expression: "document.documentElement.getAttribute('data-theme')",
    })
  })

  it('accepts a snapshot step in a steps batch, forwards it, and returns the fresh tree (act-then-observe)', async () => {
    const batchWithTree: PreviewSendOutcome = {
      ok: true,
      result: {
        action: 'steps',
        note: 'clicked button "Add" → snapshot → 3 nodes (1 interactive)',
        snapshot: {
          url: 'http://x',
          title: 'X',
          tree: '- button "Saved" [ref=e1]',
          stats: { nodes: 3, interactive: 1, chars: 20 },
        },
      },
    }
    const { tool, sent } = toolWith(batchWithTree)
    // Was hard-rejected before: STEP_ACTIONS excluded 'snapshot'.
    const parsed = tool.inputSchema.safeParse({
      action: 'steps',
      steps: [{ action: 'click', ref: 'e9' }, { action: 'snapshot' }],
    })
    expect(parsed.success).toBe(true)

    const res = await tool.execute('sn1', {
      action: 'steps',
      steps: [{ action: 'click', ref: 'e9' }, { action: 'snapshot' }],
    })
    expect(sent[0].action).toBe('steps')
    expect(sent[0].steps?.[0]).toMatchObject({ action: 'click', ref: 'e9' })
    // The snapshot step reaches the probe verbatim.
    expect(sent[0].steps?.[1]).toMatchObject({ action: 'snapshot' })
    // The batch's fresh tree comes back in the SAME call and is superseded like any snapshot.
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('[ref=e1]')
    expect(res.supersedeKey).toBe('browser')
  })

  it('rejects a targeting step with no ref and no selector (fix-it message, no probe round-trip)', async () => {
    const { tool, sent } = toolWith(snapshotResult)
    const res = await tool.execute('g1', {
      action: 'steps',
      steps: [{ action: 'click', ref: 'e1' }, { action: 'hover' }],
    })
    expect(res.isError).toBe(true)
    // The index names WHICH step, and nothing ran: a batch is checked whole before any of it.
    expect(res.content).toContain('steps[1]: a "hover" step needs a target')
    expect(sent).toHaveLength(0)
  })

  it('rejects a press step with no key/keys, and an evaluate step with no expression', async () => {
    const { tool, sent } = toolWith(snapshotResult)
    const press = await tool.execute('g2', { action: 'steps', steps: [{ action: 'press' }] })
    expect(press.isError).toBe(true)
    expect(press.content).toContain('needs a "key"')
    const evaluate = await tool.execute('g3', { action: 'steps', steps: [{ action: 'evaluate' }] })
    expect(evaluate.content).toContain('needs an "expression"')
    expect(sent).toHaveLength(0)
  })

  it('rejects an empty batch, naming the shape it needs', async () => {
    const { tool, sent } = toolWith(snapshotResult)
    const res = await tool.execute('g4', { action: 'steps', steps: [] })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('non-empty "steps" array')
    expect(sent).toHaveLength(0)
  })

  it('checks the setup steps of a screenshot batch before photographing anything', async () => {
    // A trailing screenshot step arrives as `take_screenshot` + steps (liftTrailingScreenshot);
    // its steps obey the same guards, or a half-built setup would be photographed.
    const { tool, sent } = toolWith(snapshotResult)
    const res = await tool.execute('g5', { action: 'take_screenshot', steps: [{ action: 'type' }] })
    expect(res.content).toContain('steps[0]: a "type" step needs a target')
    expect(sent).toHaveLength(0)
  })

  it('supersedes screenshots and console so they do not pile up in context', async () => {
    const shot: PreviewSendOutcome = {
      ok: true,
      result: {
        action: 'screenshot',
        target: 'b',
        rect: null,
        image: { data: 'AAAA', mediaType: 'image/png', width: 2, height: 2 },
      },
    }
    const shotRes = await toolWith(shot).tool.execute('c1', {
      action: 'take_screenshot',
      ref: 'e1',
    })
    expect(shotRes.supersedeKey).toBe('browser:screenshot')

    const con: PreviewSendOutcome = {
      ok: true,
      result: { action: 'console', console: [{ level: 'error', text: 'boom' }] },
    }
    const conRes = await toolWith(con).tool.execute('c2', { action: 'console' })
    expect(conRes.supersedeKey).toBe('browser:console')
  })
})

describe('browser action="open" and close', () => {
  test('open delegates to openPreviewCore and folds a snapshot', async () => {
    const h = harness({})
    const res = await createBrowserTool(h.deps).execute('c1', {
      action: 'open',
      url: 'http://localhost:5173',
    })
    expect(res.isError).toBeFalsy()
    expect(h.opens).toHaveLength(1)
    expect(h.opens[0].url).toBe('http://localhost:5173')
    // Open now relays ONE best-effort snapshot so the agent sees what rendered in the
    // same turn; its tree is folded into the result and superseded as 'browser'.
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].action).toBe('snapshot')
    expect(res.content).toContain('Opened preview')
    expect(res.content).toContain('- a') // the harness default snapshot tree
    expect(res.supersedeKey).toBe('browser')
  })

  test('open falls back to the plain confirmation when no probe answers the folded snapshot', async () => {
    const h = harness({
      sendOutcomes: [{ ok: false, notEngaged: true, error: 'no open preview responded' }],
    })
    const res = await createBrowserTool(h.deps).execute('c1', {
      action: 'open',
      url: 'http://localhost:5173',
    })
    // A miss on the best-effort snapshot must NEVER fail the open — plain confirmation,
    // no folded tree, no supersedeKey. (The attempt still went out.)
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('Opened preview: http://localhost:5173/')
    expect(res.content).toContain('Agent bridge not ready')
    expect(res.details).toMatchObject({ ready: false, previewId: 'http://localhost:5173' })
    expect(res.supersedeKey).toBeUndefined()
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].action).toBe('snapshot')
  })

  test('evaluate folds a page snapshot only when snapshotAfter is set (never forwarding the flag)', async () => {
    // Default: value only, one relay, NO snapshotAfter forwarded to the probe.
    const plain = harness({
      sendOutcomes: [{ ok: true, result: { action: 'evaluate', value: '42' } }],
    })
    const r1 = await createBrowserTool(plain.deps).execute('e1', {
      action: 'evaluate',
      expression: 'window.score',
    })
    expect(r1.content).toBe('42')
    expect(plain.sends).toEqual([{ action: 'evaluate', expression: 'window.score' }])

    // snapshotAfter:true → evaluate runs, THEN a follow-up snapshot is folded in.
    const withSnap = harness({
      sendOutcomes: [
        { ok: true, result: { action: 'evaluate', value: '42' } },
        {
          ok: true,
          result: {
            action: 'snapshot',
            snapshot: {
              url: 'http://x',
              title: 'X',
              tree: '- grid "board"',
              stats: { nodes: 5, interactive: 0, chars: 12 },
            },
          },
        },
      ],
    })
    const r2 = await createBrowserTool(withSnap.deps).execute('e2', {
      action: 'evaluate',
      expression: 'window.move()',
      snapshot_after: true,
    })
    expect(r2.content).toContain('42')
    expect(r2.content).toContain('- grid "board"')
    expect(withSnap.sends).toHaveLength(2)
    expect(withSnap.sends[0]).toEqual({ action: 'evaluate', expression: 'window.move()' }) // no snapshotAfter forwarded
    expect(withSnap.sends[1].action).toBe('snapshot')
  })

  test('evaluate snapshotAfter stays on the same browser tab ID', async () => {
    const h = harness({
      sendOutcomes: [
        { ok: true, result: { action: 'evaluate', previewId: 'tab-2048', value: '42' } },
        {
          ok: true,
          result: {
            action: 'snapshot',
            previewId: 'tab-2048',
            snapshot: {
              url: 'https://2048game.com/',
              title: '2048',
              tree: '- grid "board"',
              stats: { nodes: 1, interactive: 1, chars: 14 },
            },
          },
        },
      ],
    })
    await createBrowserTool(h.deps).execute('e3', {
      action: 'evaluate',
      preview_id: 'tab-2048',
      expression: 'window.score',
      snapshot_after: true,
    })
    expect(h.sends[1]).toEqual({ action: 'snapshot', previewId: 'tab-2048' })
  })

  test('a failed open returns the core error as isError', async () => {
    const h = harness({
      openResult: { ok: false, content: 'Invalid URL: localhost:9' },
    })
    const res = await createBrowserTool(h.deps).execute('c1', {
      action: 'open',
      url: 'http://localhost:9',
    })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('Invalid URL')
  })

  test('a tab that does not answer is reported as it is: nothing is reopened or retried', async () => {
    const h = harness({
      sendOutcomes: [{ ok: false, notEngaged: true, error: 'no open preview responded' }],
    })
    const res = await createBrowserTool(h.deps).execute('c1', { action: 'snapshot' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('no open preview responded')
    expect(h.opens).toHaveLength(0)
    expect(h.sends).toHaveLength(1)
  })

  test('action="close" invokes closePreview for the named tab and does NOT relay', async () => {
    const h = harness({})
    const res = await createBrowserTool(h.deps).execute('c1', {
      action: 'close',
      preview_id: 'tab-1',
    })
    expect(res.isError).toBeFalsy()
    expect(res.details?.action).toBe('close')
    expect(h.closedCount()).toBe(1)
    // Tool-only: no probe round-trip, no open call.
    expect(h.sends).toHaveLength(0)
    expect(h.opens).toHaveLength(0)
  })

  test('close without a tab ID refuses to close shared Browser tabs', async () => {
    const h = harness({})
    const res = await createBrowserTool(h.deps).execute('c3', { action: 'close' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('preview_ids')
    expect(h.closedCount()).toBe(0)
  })

  test('one close call forwards a deduplicated array of tab IDs', async () => {
    const closed: string[][] = []
    const h = harness({})
    const tool = createBrowserTool({
      ...h.deps,
      closePreview: (ids) => closed.push(ids),
    })
    const result = await tool.execute('close-many', {
      action: 'close',
      preview_ids: ['tab-a', 'tab-b', 'tab-a'],
    })
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('2 browser tabs')
    expect(closed).toEqual([['tab-a', 'tab-b']])
    expect(h.sends).toEqual([])
  })
})
