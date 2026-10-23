import { expect, test } from 'bun:test'

import { BOARD_URI, boardUri, parseKanbanUri, taskUri } from './resource'

test('a board and a card URI round-trip, whatever the session id holds', () => {
  expect(parseKanbanUri(boardUri('LOCALIX-4'))).toEqual({ kind: 'board', sessionId: 'LOCALIX-4' })
  expect(parseKanbanUri(taskUri('a/b', 'LX-2'))).toEqual({
    kind: 'task',
    sessionId: 'a/b',
    taskId: 'LX-2',
  })
  expect(parseKanbanUri(BOARD_URI)).toEqual({ kind: 'board', sessionId: null })
})

test('a URI with a missing or extra segment names nothing', () => {
  expect(parseKanbanUri(`${BOARD_URI}/s1/extra`)).toBeUndefined()
  expect(parseKanbanUri('localix://resource/kanban/task/s1')).toBeUndefined()
  expect(parseKanbanUri('localix://resource/chess/game')).toBeUndefined()
})
