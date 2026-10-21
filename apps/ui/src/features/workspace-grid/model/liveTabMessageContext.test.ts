import { beforeEach, describe, expect, test } from 'bun:test'
import {
  resourceMessageBindingDraft,
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/plugin-sdk/ui'
import {
  clearLiveTabMessageContext,
  liveTabMessageContextRevision,
  publishLiveTabMessageContext,
} from './liveTabMessageContext'
import { workItemToMessageBindings } from './tabMessageBinding'
import type { WorkItem } from '@/shared/lib/workItem'

const file: WorkItem = {
  id: 'file-1',
  kind: 'file',
  title: 'report.pdf',
  scope: 'session-1',
  payload: { path: '/workspace/report.pdf' },
}

beforeEach(() => clearLiveTabMessageContext())

describe('live tab message context', () => {
  test('append enriches static context, replace narrows it, and removal restores it', () => {
    const extracted = resourceMessageBindingDraft({
      uri: 'localix://resource/fixture-doc/abc.json',
      label: 'report.pdf',
    })
    publishLiveTabMessageContext(file.id, {
      strategy: 'append',
      bindings: [extracted],
    })
    expect(workItemToMessageBindings(file).map((binding) => binding.target.kind)).toEqual([
      'file',
      'resource',
    ])

    publishLiveTabMessageContext(file.id, {
      strategy: 'replace',
      bindings: [extracted],
    })
    expect(workItemToMessageBindings(file)).toEqual([extracted])

    publishLiveTabMessageContext(file.id, null)
    expect(workItemToMessageBindings(file)[0]?.target).toMatchObject({
      kind: 'file',
      attributes: { path: '/workspace/report.pdf' },
    })
  })

  // A user plugin published `{ strategy: 'replace', text }`, and reading its missing
  // `bindings` crashed the whole tab. An untyped value is untrusted input, never a throw.
  test('a malformed publication clears the context instead of crashing the tab', () => {
    const valid = {
      strategy: 'replace' as const,
      bindings: [snippetMessageBindingDraft({ label: 'draft', content: 'SELECT 1' })],
    }
    publishLiveTabMessageContext(file.id, valid)
    const before = liveTabMessageContextRevision()
    const malformed = [{ strategy: 'replace', text: 'idle' }, { strategy: 'clear' }, 42]
    for (const value of malformed) {
      expect(() =>
        publishLiveTabMessageContext(file.id, value as unknown as PublishedMessageContext),
      ).not.toThrow()
    }
    expect(liveTabMessageContextRevision()).toBe(before + 1)
    expect(workItemToMessageBindings(file)[0]?.target.kind).toBe('file')
  })

  test('equal publications are idempotent and an empty publication is removal', () => {
    const publication = {
      strategy: 'replace' as const,
      bindings: [snippetMessageBindingDraft({ label: 'draft', content: 'SELECT 1' })],
    }
    publishLiveTabMessageContext(file.id, publication)
    const afterFirst = liveTabMessageContextRevision()
    publishLiveTabMessageContext(file.id, publication)
    expect(liveTabMessageContextRevision()).toBe(afterFirst)

    publishLiveTabMessageContext(file.id, { strategy: 'replace', bindings: [] })
    expect(liveTabMessageContextRevision()).toBe(afterFirst + 1)
    expect(workItemToMessageBindings(file)[0]?.target.kind).toBe('file')
  })

  test('owns a cloned value and treats attribute key order as semantically equal', () => {
    const attributes = { timeframe: '4h', facet: 'candles' }
    const binding = resourceMessageBindingDraft({
      uri: 'localix://resource/fixture-market/main/BTC-USD/candles/4h',
      label: 'BTC-USD · 4h',
    })
    binding.target.attributes = attributes
    publishLiveTabMessageContext(file.id, {
      strategy: 'replace',
      bindings: [binding],
    })
    const revision = liveTabMessageContextRevision()

    attributes.timeframe = '1d'
    expect(workItemToMessageBindings(file)[0]?.target.attributes?.timeframe).toBe('4h')

    publishLiveTabMessageContext(file.id, {
      strategy: 'replace',
      bindings: [
        {
          ...binding,
          target: {
            ...binding.target,
            attributes: { facet: 'candles', timeframe: '4h' },
          },
        },
      ],
    })
    expect(liveTabMessageContextRevision()).toBe(revision)
  })

  test('applies the sandbox runtime boundary to bundled plugin publications too', () => {
    publishLiveTabMessageContext(file.id, {
      strategy: 'replace',
      bindings: [
        {
          kind: 'context',
          source: 'active-tab',
          target: {
            kind: 'resource',
            token: '@resource:spoof://wrong',
            uri: 'localix://resource/acme/current/view',
            label: '  Current view  ',
          },
        },
      ],
    })
    expect(workItemToMessageBindings(file)).toEqual([
      {
        kind: 'context',
        source: 'plugin',
        target: {
          kind: 'resource',
          token: '@resource:localix://resource/acme/current/view',
          uri: 'localix://resource/acme/current/view',
          label: 'Current view',
        },
      },
    ])

    const untrustedPublication: unknown = {
      strategy: 'replace',
      bindings: [
        {
          kind: 'context',
          source: 'plugin',
          target: {
            kind: 'file',
            token: '@file:/etc/passwd',
            label: 'host file',
            attributes: { path: '/etc/passwd' },
          },
        },
      ],
    }
    publishLiveTabMessageContext(file.id, untrustedPublication as PublishedMessageContext)
    expect(workItemToMessageBindings(file)[0]?.target.kind).toBe('file')
    expect(workItemToMessageBindings(file)[0]?.target.attributes?.path).toBe(
      '/workspace/report.pdf',
    )
  })
})
