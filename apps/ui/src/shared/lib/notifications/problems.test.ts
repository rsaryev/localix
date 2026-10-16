import { afterEach, describe, expect, it } from 'bun:test'
import type { ProblemReport } from '@localixai/plugin-sdk/ui/problems'

import { retainActionableEvents } from './actionability'
import { problemHandoffText } from './agentHandoff'
import { pendingOps } from './outbox'
import { clearProblemReport, publishProblemReport } from './problems'
import { resetNotificationsForTests, useNotificationsStore } from './store'
import type { NotificationEntry } from './types'

// Every op is applied optimistically at once; the awaits stay to prove nothing depends on timing.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const entries = () => useNotificationsStore.getState().entries
/** A distinct subject per test, so no case reads another's rows. */
const report = (subject: string, ...messages: string[]): ProblemReport => ({
  subject: { label: `${subject}.json`, path: `/w/${subject}.json` },
  problems: messages.map((message) => ({
    message,
    field: 'elements.a.type',
    location: { line: 7 },
  })),
  consequence: 'blocked',
})

afterEach(resetNotificationsForTests)

describe('standing problems in the Event Center', () => {
  it('records the report with its headline and the fix, not a flattened message', async () => {
    publishProblemReport(
      {
        ...report('headline'),
        problems: [{ message: 'an element has no "type"', hint: 'write "recipe" instead' }],
      },
      { scope: 'documents' },
    )
    await settle()
    const entry = entries()[0]!
    // A lone problem IS the headline: the count would hide the only sentence that helps.
    expect(entry.title).toBe('an element has no "type"')
    expect(entry.message).toContain('write "recipe" instead')
  })

  it('republishing the same problems keeps ONE row — a save loop is not a log', async () => {
    const same = report('loop', 'a', 'b')
    const first = publishProblemReport(same, { scope: 'documents' })
    await settle()
    const second = publishProblemReport(same, { scope: 'documents' })
    await settle()
    expect(second).toBe(first!)
    expect(entries()).toHaveLength(1)
  })

  it('fixing one of two settles the old row instead of leaving it asserting a lie', async () => {
    publishProblemReport(report('fixed', 'a', 'b'), { scope: 'documents' })
    await settle()
    publishProblemReport(report('fixed', 'a'), { scope: 'documents' })
    await settle()
    const [live, superseded] = entries()
    expect(live!.title).toBe('a')
    expect(live!.resolvedAt).toBeUndefined()
    expect(superseded!.resolvedAt).toBeGreaterThan(0)
  })

  it('a subject that validates again settles everything the centre said about it', async () => {
    publishProblemReport(report('healed', 'a'), { scope: 'documents' })
    await settle()
    clearProblemReport(report('healed'), 'documents')
    expect(entries().every((entry) => entry.resolvedAt != null)).toBe(true)
  })

  it('a problem that comes back after it was fixed is live again, not still "Resolved"', async () => {
    const broken = report('relapse', 'a')
    const id = publishProblemReport(broken, { scope: 'documents' })
    await settle()
    clearProblemReport(broken, 'documents')
    // Broken again the same way, well inside the hour the router would otherwise suppress it for.
    publishProblemReport(broken, { scope: 'documents' })
    await settle()
    expect(entries()).toHaveLength(1)
    expect(entries()[0]).toMatchObject({ id, read: false })
    expect(entries()[0]!.resolvedAt).toBeUndefined()
  })

  it('two publishes in one tick leave the NEWER report live', async () => {
    publishProblemReport(report('burst', 'a', 'b'), { scope: 'documents' })
    publishProblemReport(report('burst', 'a'), { scope: 'documents' })
    await settle()
    const live = entries().filter((entry) => entry.resolvedAt == null)
    expect(live.map((entry) => entry.title)).toEqual(['a'])
  })

  it('a republish of the standing report sends nothing — a save loop is not traffic either', () => {
    const same = report('quiet', 'a')
    publishProblemReport(same, { scope: 'documents' })
    const sent = pendingOps().length
    publishProblemReport(same, { scope: 'documents' })
    publishProblemReport(same, { scope: 'documents' })
    expect(pendingOps()).toHaveLength(sent)
  })

  it('records the report as a standing condition the server can reopen', () => {
    publishProblemReport(report('wire', 'a'), { scope: 'documents' })
    const [raise, settleOp] = pendingOps()
    expect(raise).toMatchObject({ op: 'raise', fact: { condition: true } })
    // The superseded reports of the subject settle in the same ordered stream, keeping this one.
    expect(settleOp).toMatchObject({
      op: 'settle',
      fact: { prefix: 'application.condition:documents:%2Fw%2Fwire.json:', reason: 'fixed' },
    })
    expect(settleOp?.op === 'settle' && settleOp.fact.keep).toBe(
      raise?.op === 'raise' ? raise.fact.key : undefined,
    )
  })

  it('keeps an enormous report within the key the server accepts, and still settles it', () => {
    const many = report(
      'huge',
      ...Array.from({ length: 80 }, (_, i) => `problem number ${i} is a long one`),
    )
    const key = publishProblemReport(many, { scope: 'documents' })!
    expect(key.length).toBeLessThanOrEqual(400)
    clearProblemReport(many, 'documents')
    expect(entries().find((entry) => entry.id === key)?.resolvedAt).toBeGreaterThan(0)
  })

  it('a superseded set that returns is live again too', async () => {
    publishProblemReport(report('flip', 'a', 'b'), { scope: 'documents' })
    await settle()
    publishProblemReport(report('flip', 'a'), { scope: 'documents' })
    await settle()
    publishProblemReport(report('flip', 'a', 'b'), { scope: 'documents' })
    await settle()
    const live = entries().filter((entry) => entry.resolvedAt == null)
    expect(live.map((entry) => entry.title)).toEqual([entries()[0]!.title])
    expect(entries()[0]!.message).toContain('b')
  })

  it("keeps the engine's exact words, and does not print them twice", async () => {
    // `detail` is the whole reason the surface line can stay one sentence: the raw text has a place
    // to go. This is that place — and a producer that filled `detail` with the message it already
    // classified must not get the same sentence stuttered back at it.
    publishProblemReport(
      {
        ...report('detail'),
        problems: [
          { message: 'The database is unreachable.', detail: 'dial unix /x/db.sock: no such file' },
          { message: 'The query timed out.', detail: 'The query timed out.' },
        ],
      },
      { scope: 'database' },
    )
    await settle()
    const body = entries()[0]!.message!
    expect(body).toContain('dial unix /x/db.sock: no such file')
    expect(body.match(/The query timed out\./g)).toHaveLength(1)
  })

  it('offers the recovery the surface offers — except what only makes sense on the surface', async () => {
    // One list, two renderers. `durable: false` is the only asymmetry, and it exists because
    // "stop showing me this" says nothing to a record read an hour after the pane closed.
    publishProblemReport(report('recovery', 'a'), {
      scope: 'database',
      actions: [
        { id: 'retry', label: 'Retry', run: () => {} },
        { id: 'dismiss', label: 'Dismiss', run: () => {}, durable: false },
      ],
    })
    await settle()
    const labels = (entries()[0]!.actions ?? []).map((action) => action.label)
    expect(labels).toContain('Retry')
    expect(labels).not.toContain('Dismiss')
  })

  it('two subjects never share a row', async () => {
    publishProblemReport(report('first', 'a'), { scope: 'documents' })
    await settle()
    publishProblemReport(report('second', 'a'), { scope: 'documents' })
    await settle()
    expect(entries()).toHaveLength(2)
  })
})

describe('handing a problem to the agent', () => {
  it('carries the report verbatim — the agent reads what the centre wrote, not a paraphrase', () => {
    const entry: NotificationEntry = {
      id: 'application.condition:x',
      topic: 'application.notification',
      category: 'system',
      severity: 'error',
      title: 'an element has no "type"',
      message: 'elements.map.type line 7\n  → write "recipe": "mindmap"',
      origin: { kind: 'application', label: 'documents' },
      ts: 0,
      read: false,
    }
    const text = problemHandoffText(entry)
    expect(text).toContain('documents')
    expect(text).toContain('an element has no "type"')
    expect(text).toContain('→ write "recipe": "mindmap"')
  })
})

describe('clearing history', () => {
  it('keeps a problem that is still true, even once its buttons are dead', () => {
    // After a reload every callback action is gone by design, so "still has a live button" is
    // not the same question as "still broken" — and only the second one may delete a row.
    const standing: NotificationEntry = {
      id: 'application.condition:documents:/w/config.json:e',
      topic: 'application.notification',
      category: 'system',
      severity: 'error',
      title: 'config.json will not validate',
      origin: { kind: 'application' },
      condition: true,
      ts: 0,
      read: true,
    }
    const settled: NotificationEntry = { ...standing, id: 'plain', resolvedAt: 1 }
    expect(retainActionableEvents([standing, settled]).map((entry) => entry.id)).toEqual([
      standing.id,
    ])
  })
})
