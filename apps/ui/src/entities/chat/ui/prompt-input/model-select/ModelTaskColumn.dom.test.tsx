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
        participants={[]}
      />,
    )

    expect(html).toContain('aria-label="Enable Session titles"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('GPT 5.6 · saved')
    // Delegated runs have no route group here any more: an agent's model is its record's.
    expect(html).not.toContain('Delegated task runs')
  })

  test("lists the conversation's party in place of the single session row", () => {
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="agent:builtin:reviewer"
        onSelectTask={() => {}}
        modelLabelFor={(key) => (key === 'agent:builtin:reviewer' ? 'Claude Opus 5' : null)}
        enabledFor={() => true}
        onEnabledChange={() => {}}
        participants={[
          {
            agentId: 'builtin:localix',
            handle: 'localix',
            label: 'Localix',
            inheritedLabel: 'Use anthropic/haiku',
          },
          { agentId: 'builtin:reviewer', handle: 'reviewer', label: 'Reviewer' },
        ]}
      />,
    )

    // One row per participant, named by the registry, each with its own model.
    expect(html).toContain('Localix')
    expect(html).toContain('Reviewer')
    expect(html).toContain('Claude Opus 5')
    // The one with no choice of its own falls back to that agent's own registry model.
    expect(html).toContain('Use anthropic/haiku')
    // The single "Chat sessions" row is what the party replaces — it cannot describe a room.
    expect(html).not.toContain('Chat sessions')
    // Every group is labelled the same way, the party's included.
    expect(html).toContain('Agents')
    expect(html).toContain('Background workloads')
    expect(html).toContain('Session titles')
  })

  test('with no conversation open the same heading covers the stand-in session row', () => {
    // The agent editor and onboarding open the same picker with nobody to list. That is not a
    // special case in the component: a party is a list, and this one has nothing in it — the
    // `session` row stands in, under the heading the participants would have had, because both
    // answer the same question about who the chat runs as.
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="session"
        onSelectTask={() => {}}
        modelLabelFor={() => null}
        enabledFor={() => true}
        onEnabledChange={() => {}}
        participants={[]}
      />,
    )

    expect(html).toContain('Chat sessions')
    expect(html).toContain('Agents')
    expect(html).toContain('Background workloads')
  })

  test('a participant the registry cannot name still gets a row', () => {
    // A disabled or deleted agent leaves a handle behind on the conversation. Hiding the row
    // would make the picker disagree with a transcript that still shows that agent speaking.
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="agent:deleted:ghost"
        onSelectTask={() => {}}
        modelLabelFor={() => null}
        enabledFor={() => true}
        onEnabledChange={() => {}}
        participants={[{ agentId: 'deleted:ghost', handle: 'ghost' }]}
      />,
    )

    expect(html).toContain('ghost')
    // Rendered through JSX, so the apostrophe arrives HTML-escaped.
    expect(html).toContain('Use @ghost&#x27;s model')
  })

  test('offers the Session recap workload with its own switch, on, falling back to the chat model', () => {
    const html = renderToStaticMarkup(
      <ModelTaskColumn
        activeTask="session"
        onSelectTask={() => {}}
        modelLabelFor={() => null}
        enabledFor={() => true}
        onEnabledChange={() => {}}
        participants={[]}
      />,
    )

    expect(html).toContain('Session recap')
    expect(html).toContain('aria-label="Disable Session recap"')
    expect(html).toContain('Use session model')
  })
})
