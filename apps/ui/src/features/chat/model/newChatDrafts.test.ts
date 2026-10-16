import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import { createNewChatDrafts } from './newChatDrafts'

const plan = { projectId: 'P', agentId: 'builtin:localix' }
const row = (patch: Partial<UiSession> = {}): UiSession =>
  ({
    id: 'draft',
    projectId: 'P',
    title: 'New Chat',
    sessionKind: 'chat',
    messageCount: 0,
    messages: [],
    isRunning: false,
    isPinned: false,
    agents: [{ agentId: plan.agentId, handle: 'localix' }],
    ...patch,
  }) as UiSession

describe('window-owned draft eligibility', () => {
  test('ownership expires instead of opening a weeks-old empty chat', () => {
    let clock = 0
    const drafts = createNewChatDrafts(() => clock)
    const session = row()
    drafts.remember(session, 'P')
    expect(drafts.find([session], null, plan)).toBe(session)
    clock = 14 * 24 * 60 * 60 * 1000
    expect(drafts.find([session], session.id, plan)).toBeUndefined()
  })

  test.each([
    { messageCount: undefined },
    { messageCount: 3 },
    { isPinned: true },
    { isArchived: true },
    { title: 'Keep this' },
    { isRunning: true },
    { agents: [{ agentId: 'other', handle: 'other' }] },
    {
      agents: [
        { agentId: plan.agentId, handle: 'localix' },
        { agentId: 'other', handle: 'other' },
      ],
    },
  ] as Partial<UiSession>[])('rejects used, reserved and different-party chats: %j', (patch) => {
    const drafts = createNewChatDrafts()
    const session = row(patch)
    drafts.remember(session, 'P')
    expect(drafts.find([session], session.id, plan)).toBeUndefined()
  })

  test('unresolved default scope reuses its own canonical response', () => {
    const drafts = createNewChatDrafts()
    const session = row()
    drafts.remember(session, null)
    expect(drafts.find([session], null, { ...plan, projectId: null })).toBe(session)
    expect(drafts.find([session], null, { ...plan, projectId: 'other' })).toBeUndefined()
    drafts.forget(session.id)
    expect(drafts.find([session], null, plan)).toBeUndefined()
  })
})
