import { expect, test } from 'bun:test'

import type { MessageContextBinding } from './chat'
import {
  selectedSystemContextTokens,
  systemContextSelectionBinding,
  latestSystemContextBindings,
} from './chat'

function binding(id: string, token: string): MessageContextBinding {
  return {
    kind: 'context',
    id,
    source: 'system',
    target: { kind: 'system-event', token, label: id },
    resolution: { status: 'resolved', contributions: [] },
  }
}

test('latest context binding wins per semantic target and surviving order stays chronological', () => {
  expect(
    latestSystemContextBindings([
      {
        role: 'user',
        bindings: [
          binding('model-a', 'model'),
          binding('run-failed', 'run'),
          binding('model-b', 'model'),
        ],
      },
      {
        role: 'user',
        bindings: [binding('run-interrupted', 'run'), binding('model-a-again', 'model')],
      },
    ]).map((item) => item.id),
  ).toEqual(['run-interrupted', 'model-a-again'])
})

test('system context selection is an empty binding carrying the enabled state slots', () => {
  const selection = systemContextSelectionBinding('s1', ['run', 'model'])
  expect(selection.resolution).toEqual({ status: 'empty', contributions: [] })
  expect([...selectedSystemContextTokens(selection)!]).toEqual(['model', 'run'])
})

test('a completed assistant turn clears a stale run outcome', () => {
  expect(
    latestSystemContextBindings([
      { role: 'system', bindings: [binding('failed', 'run:latest-status')] },
      { role: 'assistant' },
    ]),
  ).toEqual([])
  expect(
    latestSystemContextBindings([
      { role: 'assistant' },
      { role: 'system', bindings: [binding('interrupted', 'run:latest-status')] },
    ]).map((item) => item.id),
  ).toEqual(['interrupted'])
})
