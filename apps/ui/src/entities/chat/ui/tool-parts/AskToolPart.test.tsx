import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolCallItem } from '@localixai/agent/agents'
import type { AskToolDetails } from '@localixai/api/client'
import { AskToolPart } from './AskToolPart'

const input = {
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
    name: 'AskUserQuestion',
    status: 'completed',
    activeVerb: 'Awaiting user input',
    input,
    output,
  }) as ToolCallItem

describe('an ask in the transcript', () => {
  test('answered: the answer, in the words the person saw', () => {
    const html = renderToStaticMarkup(
      <AskToolPart
        item={item({
          answers: [{ id: 'db', question: 'Which database?', selectedOptions: ['pg'] }],
        })}
      />,
    )
    expect(html).toContain('Postgres')
  })

  test('expired: it closes as unanswered, never as an error', () => {
    const html = renderToStaticMarkup(<AskToolPart item={item({ expired: true })} />)
    expect(html).toContain('No one answered in 5 minutes')
    expect(html).not.toContain('An error occurred')
  })
})
