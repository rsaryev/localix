import { describe, expect, test } from 'bun:test'
import {
  LIVE_SNIPPET_CONTENT_MAX,
  normalizePublishedMessageContext,
  snippetMessageBindingDraft,
  type WorkItemAgentContext,
  type WorkItemKindContribution,
} from './contrib'

test('work-item contributions may advertise stable agent tools and next steps', () => {
  const agentContext = {
    tools: ['fixture_tool'],
    nextSteps: ['Inspect the fixture.'],
  } satisfies WorkItemAgentContext
  const contribution = {
    kind: 'fixture:view',
    Component: (() => null) as never,
    Icon: (() => null) as never,
    agentContext,
  } satisfies WorkItemKindContribution
  expect(contribution.agentContext).toEqual(agentContext)
})

describe('snippetMessageBindingDraft', () => {
  test('bounds live UI state before it enters the process-local registry', () => {
    const draft = snippetMessageBindingDraft({
      label: 'large draft',
      content: 'x'.repeat(LIVE_SNIPPET_CONTENT_MAX + 1000),
    })
    const content = draft.target.attributes?.content
    expect(typeof content).toBe('string')
    expect((content as string).length).toBe(LIVE_SNIPPET_CONTENT_MAX)
    expect(content).toEndWith('[live context snapshot truncated]')
  })
})

describe('normalizePublishedMessageContext', () => {
  test('forces plugin provenance and canonicalizes an opaque resource token', () => {
    expect(
      normalizePublishedMessageContext({
        strategy: 'replace',
        bindings: [
          {
            kind: 'context',
            source: 'active-tab',
            target: {
              kind: 'resource',
              token: '@resource:localix://resource/spoof/wrong',
              label: 'Current view',
              uri: 'localix://resource/acme/workspace/live',
              attributes: { facet: 'live' },
            },
          },
        ],
      }),
    ).toEqual({
      strategy: 'replace',
      bindings: [
        {
          kind: 'context',
          source: 'plugin',
          target: {
            kind: 'resource',
            token: '@resource:localix://resource/acme/workspace/live',
            label: 'Current view',
            uri: 'localix://resource/acme/workspace/live',
            attributes: { facet: 'live' },
          },
        },
      ],
    })
  })

  test('rejects an empty publication and a resource without a provider URI', () => {
    expect(normalizePublishedMessageContext({ strategy: 'append', bindings: [] })).toBeNull()
    expect(
      normalizePublishedMessageContext({
        strategy: 'append',
        bindings: [
          {
            target: {
              kind: 'resource',
              token: '@resource:missing',
              label: 'missing',
            },
          },
        ],
      }),
    ).toBeNull()
  })

  test('rejects plugin attempts to impersonate core-owned target kinds', () => {
    expect(
      normalizePublishedMessageContext({
        strategy: 'replace',
        bindings: [
          {
            target: {
              kind: 'file',
              token: '@file:/etc/passwd',
              label: 'host file',
              attributes: { path: '/etc/passwd' },
            },
          },
        ],
      }),
    ).toBeNull()
  })
})
