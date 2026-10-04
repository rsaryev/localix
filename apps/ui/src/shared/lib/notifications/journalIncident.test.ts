import { beforeEach, describe, expect, it } from 'bun:test'
import { createJournalIncident } from './journalIncident'
import { resetNotificationsForTests, useNotificationsStore } from './store'
import { resetEventTrace } from './trace'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  resetNotificationsForTests()
  resetEventTrace()
})

function incident() {
  return createJournalIncident({
    kind: 'transport.connection',
    origin: {
      kind: 'resource',
      sessionId: 'LOCALIX-18',
      projectId: 'project-1',
      resourceKind: 'terminal',
      resourceId: 'pty-42',
      label: 'Terminal',
    },
    unavailable: {
      severity: 'warning',
      title: 'Connection unavailable',
      message: 'Retrying stopped.',
    },
    recovered: {
      severity: 'success',
      title: 'Connection restored',
    },
  })
}

describe('journal incident lifecycle', () => {
  it('keeps transient incidents quiet', async () => {
    const lifecycle = incident()
    expect(lifecycle.begin(10)).toBeTrue()
    expect(lifecycle.begin(11)).toBeFalse()
    lifecycle.recover({ ts: 12 })
    await flush()
    expect(useNotificationsStore.getState().entries).toEqual([])
  })

  it('publishes one failure and a correlated recovery with exact provenance', async () => {
    const lifecycle = incident()
    const startedAt = Date.now()
    lifecycle.begin(startedAt)
    lifecycle.fail({ ts: startedAt + 10, attributes: { attempts: 6 } })
    lifecycle.fail({ ts: startedAt + 11 })
    await flush()

    expect(useNotificationsStore.getState().entries).toHaveLength(1)
    expect(useNotificationsStore.getState().entries[0]).toMatchObject({
      severity: 'warning',
      title: 'Connection unavailable',
      origin: {
        sessionId: 'LOCALIX-18',
        resourceKind: 'terminal',
        resourceId: 'pty-42',
      },
    })

    lifecycle.recover({ ts: startedAt + 20 })
    await flush()
    // One row, settled — not a live "unavailable" beside a separate "restored".
    const entries = useNotificationsStore.getState().entries
    expect(entries.map((entry) => entry.title)).toEqual(['Connection unavailable'])
    expect(entries[0]?.resolvedAt).toBeGreaterThan(0)
    expect(entries[0]?.trace?.map((step) => step.phase)).toEqual(['started', 'failed', 'event'])
  })

  it('the next outage reopens the same row with a count', async () => {
    const lifecycle = incident()
    lifecycle.fail()
    await flush()
    lifecycle.recover()
    lifecycle.fail()
    await flush()
    const entries = useNotificationsStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ occurrenceCount: 2, title: 'Connection unavailable' })
    expect(entries[0]?.resolvedAt).toBeUndefined()
  })

  it('settles an outage restored from the journal on the first recovery, and on teardown', async () => {
    const lifecycle = incident()
    lifecycle.fail()
    await flush()
    // A reload: the row came back from the journal, the in-memory incident did not.
    const reloaded = incident()
    reloaded.recover()
    expect(useNotificationsStore.getState().entries[0]?.resolvedAt).toBeGreaterThan(0)

    const closing = incident()
    closing.fail()
    await flush()
    closing.abandon()
    expect(useNotificationsStore.getState().entries[0]?.resolvedAt).toBeGreaterThan(0)
  })
})
