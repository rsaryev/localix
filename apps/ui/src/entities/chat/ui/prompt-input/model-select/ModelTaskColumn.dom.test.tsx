import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelTaskColumn } from './ModelTaskColumn'

describe('ModelTaskColumn', () => {
  test('shows a disabled workload without erasing its saved assignment', () => {
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="titleGeneration"
        onSelectTask={() => {}}
        modelLabelFor={(key) => (key === 'titleGeneration' ? 'GPT 5.6' : null)}
        enabledFor={(key) => key !== 'titleGeneration'}
        onEnabledChange={() => {}}
      />,
    )

    expect(html).toContain('aria-label="Enable Session titles"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('GPT 5.6 · saved')
    // Delegated runs have no route group here any more: an agent's model is its record's.
    expect(html).not.toContain('Delegated task runs')
  })

  test("lists the conversation's agent in place of the single session row", () => {
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="agent:builtin:localix"
        onSelectTask={() => {}}
        modelLabelFor={(key) => (key === 'agent:builtin:localix' ? 'Claude Opus 5' : null)}
        enabledFor={() => true}
        onEnabledChange={() => {}}
        agent={{ agentId: 'builtin:localix', name: 'localix' }}
      />,
    )

    // The agent is named by its file and shows its own model.
    expect(html).toContain('localix')
    expect(html).toContain('Claude Opus 5')
    // The single "Chat sessions" row is what the agent's row replaces.
    expect(html).not.toContain('Chat sessions')
    expect(html).toContain('This chat')
    expect(html).toContain('Background workloads')
    expect(html).toContain('Session titles')
  })

  test('an agent with no model of its own falls back to its registry model', () => {
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="agent:builtin:localix"
        onSelectTask={() => {}}
        modelLabelFor={() => null}
        enabledFor={() => true}
        onEnabledChange={() => {}}
        agent={{
          agentId: 'builtin:localix',
          name: 'localix',
          inheritedLabel: 'Use anthropic/haiku',
        }}
      />,
    )

    expect(html).toContain('Use anthropic/haiku')
  })

  test('with no conversation open the same heading covers the stand-in session row', () => {
    // The agent editor and onboarding open the same picker with no agent to list: the `session`
    // row stands in, under the heading the agent would have had.
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="session"
        onSelectTask={() => {}}
        modelLabelFor={() => null}
        enabledFor={() => true}
        onEnabledChange={() => {}}
      />,
    )

    expect(html).toContain('Chat sessions')
    expect(html).toContain('This chat')
    expect(html).toContain('Background workloads')
  })

  test('an agent the registry cannot name still gets a row', () => {
    // A disabled or deleted agent leaves a handle behind on the conversation. Hiding the row
    // would make the picker disagree with the transcript that still shows that agent.
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="agent:deleted:ghost"
        onSelectTask={() => {}}
        modelLabelFor={() => null}
        enabledFor={() => true}
        onEnabledChange={() => {}}
        agent={{ agentId: 'deleted:ghost', name: 'ghost' }}
      />,
    )

    expect(html).toContain('ghost')
    // Rendered through JSX, so the apostrophe arrives HTML-escaped.
    expect(html).toContain('Use ghost&#x27;s model')
  })

  test('offers the Session recap workload with its own switch, on, falling back to the chat model', () => {
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="session"
        onSelectTask={() => {}}
        modelLabelFor={() => null}
        enabledFor={() => true}
        onEnabledChange={() => {}}
      />,
    )

    expect(html).toContain('Session recap')
    expect(html).toContain('aria-label="Disable Session recap"')
    expect(html).toContain('Use session model')
  })
})
