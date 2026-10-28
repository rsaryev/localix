import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchHitsOf } from '@localixai/mini-app-sdk/backend'

import { boardUri, taskUri } from '../shared/resource'
import { createBoardResourceProvider, createBoardSearchProvider } from './references'
import { createBoardService } from './service'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kanban-refs-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function seeded() {
  const boards = createBoardService({ resolveDir: async (_user, session) => join(root, session) })
  const chat = { userId: 'u1', sessionId: 's1' }
  await boards.create(chat, { title: 'Release', kind: 'epic' }, 'agent')
  await boards.create(chat, { title: 'Write changelog', parentTaskId: 'LX-1' }, 'agent')
  return boards
}

describe('board resource provider', () => {
  test('lists the chat’s top-level cards, and an epic’s tasks beneath it', async () => {
    const provider = createBoardResourceProvider(await seeded())
    const roots = await provider.listChildren('u1', null, undefined, { sessionId: 's1' })
    expect(roots.map((node) => [node.label, node.hasChildren])).toEqual([['LX-1 Release', true]])
    const children = await provider.listChildren('u1', roots[0]!.uri)
    expect(children.map((node) => node.label)).toEqual(['LX-2 Write changelog'])
  })

  test('with no chat in scope there is nothing to list', async () => {
    const provider = createBoardResourceProvider(await seeded())
    expect(await provider.listChildren('u1', null)).toEqual([])
  })

  test('expands a card to its brief and the board to its outline', async () => {
    const provider = createBoardResourceProvider(await seeded())
    const card = await provider.expand('u1', taskUri('s1', 'LX-2'))
    expect(card.content).toContain('LX-2: Write changelog')
    const board = await provider.expand('u1', boardUri('s1'))
    expect(board.content).toContain('epic LX-1 — Release')
  })

  test('a card that is gone expands to a reason, not to nothing', async () => {
    const provider = createBoardResourceProvider(await seeded())
    expect(await provider.expand('u1', taskUri('s1', 'LX-9'))).toEqual({
      ok: false,
      error: 'LX-9 is no longer on the board.',
    })
  })
})

describe('board search provider', () => {
  test('finds the cards of the chat the search carries and opens them by URI', async () => {
    const provider = createBoardSearchProvider(await seeded())
    const hits = searchHitsOf(await provider.search('u1', { text: 'changelog', sessionId: 's1' }))
    expect(hits.map((hit) => [hit.title, hit.id])).toEqual([
      ['Write changelog', taskUri('s1', 'LX-2')],
    ])
  })

  test('without a chat it answers nothing rather than reading every board', async () => {
    const provider = createBoardSearchProvider(await seeded())
    expect(await provider.search('u1', { text: 'changelog' })).toEqual([])
  })
})
