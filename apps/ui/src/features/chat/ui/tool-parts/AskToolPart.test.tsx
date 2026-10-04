import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolCallItem } from '@localixai/agent/agents'
import type { AskToolDetails } from '@localixai/api/client'
import { AskToolPart } from './AskToolPart'

const input = {
  wait: false,
  questions: [
    {
      id: 'db',
      question: 'Which database?',
      options: [{ label: 'Postgres', value: 'pg' }, { label: 'SQLite' }],
    },
  ],
}

const item = (output: AskToolDetails): ToolCallItem =>
  ({
    id: 'item-1',
    type: 'tool_call',
    toolCallId: 'call-ask',
    name: 'ask',
    status: 'completed',
    activeVerb: 'Awaiting user input',
    input,
    output,
  }) as ToolCallItem

/** A queued question's card says how it ended — the host rewrites it when it closes. */
describe('a queued ask in the transcript', () => {
  test('open: it says the agent is waiting for an answer, by the id the strip shows', () => {
    const html = renderToStaticMarkup(
      <AskToolPart item={item({ queued: { questionId: 'q-2', status: 'pending' } })} />,
    )
    expect(html).toContain('q-2 · waiting for your answer')
  })

  test('answered later: the answer, in the words the person saw, under its id', () => {
    const html = renderToStaticMarkup(
      <AskToolPart
        item={item({
          queued: { questionId: 'q-2', status: 'answered' },
          answers: [{ id: 'db', question: 'Which database?', selectedOptions: ['pg'] }],
        })}
      />,
    )
    expect(html).toContain('q-2 · Postgres')
  })

  test('skipped and superseded read as closed, not as answered', () => {
    const skipped = renderToStaticMarkup(
      <AskToolPart item={item({ queued: { questionId: 'q-2', status: 'skipped' } })} />,
    )
    expect(skipped).toContain('skipped — the agent decides')
    const replaced = renderToStaticMarkup(
      <AskToolPart item={item({ queued: { questionId: 'q-2', status: 'superseded' } })} />,
    )
    expect(replaced).toContain('asked again later')
  })
})

/** `from` names an earlier question by id; the card still shows WHAT was asked. */
describe('a re-asked question', () => {
  test('its questions come from the details, since the call carried only an id', () => {
    const html = renderToStaticMarkup(
      <AskToolPart
        item={{
          ...item({ questions: input.questions, stillOpen: 'q-2' }),
          input: { from: 'q-2', wait: false },
        }}
      />,
    )
    expect(html).toContain('Which database?')
    expect(html).toContain('q-2 · already in the queue')
  })
})
