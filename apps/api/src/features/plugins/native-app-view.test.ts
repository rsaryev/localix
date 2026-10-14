import { describe, expect, test } from 'bun:test'

import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { asToolArray } from './native-coerce'
import { withAppViewLine } from './native-app-view'

const BOARD = 'localix://resource/fixture-board/s1'
const offer = { type: 'ui.navigate', uri: BOARD, label: 'Open board' }

function pluginTool(result: AgentToolResult): AgentTool {
  const tools = asToolArray({
    name: 'fixture_board',
    description: 'Fixture board',
    inputSchema: {},
    execute: async () => result,
  })
  return tools[0]!
}

describe('native plugin app views', () => {
  test('names an offered destination to the model through the plugin tool adapter', async () => {
    const result = await pluginTool({ content: 'Created LX-1.', details: offer }).execute('c1', {})

    expect(result.content).toBe(`Created LX-1.\nApp view: ${BOARD}`)
    expect(result.details).toEqual(offer)
  })

  test('reads an offer nested under details.reveal', () => {
    const result = withAppViewLine({
      content: 'Created LX-1.',
      details: { sessionId: 's1', reveal: offer },
    })

    expect(result.content).toBe(`Created LX-1.\nApp view: ${BOARD}`)
  })

  test('adds the line to model-facing parts too', () => {
    const result = withAppViewLine({
      content: 'Rendered.',
      contentParts: [{ type: 'text', text: 'Rendered.' }],
      details: offer,
    })

    expect(result.contentParts?.at(-1)).toEqual({ type: 'text', text: `App view: ${BOARD}` })
  })

  test('leaves results alone that already name the URI or offer nothing', () => {
    const named = { content: `Board at ${BOARD}.`, details: offer }
    const plain = { content: 'Done.', details: { sessionId: 's1' } }
    const writeAction = {
      content: 'Done.',
      details: { type: 'ui.navigate', uri: 'localix://ui/action/command/x', label: 'Run' },
    }

    expect(withAppViewLine(named)).toBe(named)
    expect(withAppViewLine(plain)).toBe(plain)
    expect(withAppViewLine(writeAction)).toBe(writeAction)
  })
})
