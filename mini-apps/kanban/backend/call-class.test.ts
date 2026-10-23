import { expect, test } from 'bun:test'
import type { CallClass } from '@localixai/mini-app-sdk/backend'
import { classifyKanbanCall } from './call-class'

const rows: Array<[string, unknown, CallClass]> = [
  ['list', { action: 'list' }, { effect: 'read' }],
  ['search', { action: 'search', query: 'auth' }, { effect: 'read' }],
  ['detail', { action: 'detail', id: 't1' }, { effect: 'read' }],
  ['create', { action: 'create' }, { effect: 'session' }],
  ['update', { action: 'update', id: 't1' }, { effect: 'session' }],
  ['take', { action: 'take', id: 't1' }, { effect: 'session' }],
  ['complete', { action: 'complete', id: 't1' }, { effect: 'session' }],
  ['block', { action: 'block', id: 't1' }, { effect: 'session' }],
  ['reorder', { action: 'reorder' }, { effect: 'session' }],
  ['delete', { action: 'delete', id: 't1' }, { effect: 'session', irreversible: true }],
  ['unknown action', { action: 'archive' }, { effect: 'external' }],
  ['no action', {}, { effect: 'external' }],
]

test.each(rows)('kanban %s', (_label, input, expected) => {
  expect(classifyKanbanCall(input)).toEqual(expected)
})
