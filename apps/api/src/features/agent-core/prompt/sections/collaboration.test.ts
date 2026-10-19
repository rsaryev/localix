import { describe, expect, test } from 'bun:test'

import { buildCollaborationSection } from './collaboration'
import { TOOL } from '../../tool-names'

const all = [TOOL.delegate]
const chat = { inConversation: true }

describe('# Collaboration follows the room', () => {
  test('alone, the agent does the work itself and delegates only side work', () => {
    const solo = buildCollaborationSection(all, { withColleagues: false, ...chat })!
    expect(solo).toContain('Handle straightforward work directly')
    expect(solo).toContain('Broad investigation goes to `delegate`')
    expect(solo).toContain('Do a focused lookup yourself')
    expect(solo).toContain('Bring in a suitable agent from the directory')
  })

  // Regression: @architect, not the leader, read "do the work yourself … delegate substantial
  // work" with @frontend and @qa already in the room, and sent both cards to one-shot children.
  test('with colleagues, a colleague’s part goes to them by address', () => {
    const room = buildCollaborationSection(all, { withColleagues: true })!
    expect(room).not.toContain('Handle straightforward work directly')
    expect(room).toContain('participant whose role owns it')
    expect(room).toContain('by @mentioning them')
    expect(room).not.toContain('conversation_control')
  })

  // A child starts from its task alone and does not block the caller unless asked to.
  test('delegation names its agent choice, clean context and non-blocking default', () => {
    const section = buildCollaborationSection(all, { withColleagues: false, ...chat })!
    expect(section).toContain('`agent` names a directory agent')
    expect(section).toContain('It sees only the task')
    expect(section).toContain('Leave wait off')
    expect(buildCollaborationSection([], { withColleagues: true })).not.toMatch(/\bdelegat/i)
  })

  test('each bullet stays gated on what the run can do', () => {
    const room = buildCollaborationSection([], { withColleagues: true })!
    expect(room).not.toContain('`delegate`')
    expect(room).not.toContain('running child')
    const job = buildCollaborationSection([TOOL.delegate], { withColleagues: false })!
    expect(job).toContain('`delegate`')
    expect(job).not.toContain('Bring in')
    // No delegation, no conversation to grow, no colleagues: nothing to decide.
    expect(buildCollaborationSection([], { withColleagues: false })).toBeNull()
  })

  test('creates a missing specialization only with authoring and open membership', () => {
    const tools = [...all, TOOL.agents]
    const open = buildCollaborationSection(tools, { withColleagues: false, ...chat })!
    expect(open).toContain('Create missing reusable specialists with `agents`')
    expect(open).toContain('below the current leader’s priority')
    expect(open).toContain('then @mention the created handles')
    expect(open).toContain('even while alone')
    expect(
      buildCollaborationSection(tools, { withColleagues: false, ...chat, membershipClosed: true }),
    ).not.toContain('`agents`')
    expect(buildCollaborationSection(all, { withColleagues: false, ...chat })).not.toContain(
      '`agents`',
    )
  })

  test('only the elected leader owns proactive team assembly', () => {
    const tools = [...all, TOOL.agents]
    const leader = buildCollaborationSection(tools, { withColleagues: true, isLeader: true })!
    const member = buildCollaborationSection(tools, { withColleagues: true, isLeader: false })!
    expect(leader).toContain('Create all missing specialists in one batch')
    expect(leader).toContain('do not wait for the user to name roles')
    expect(member).not.toContain('do not wait for the user to name roles')
    expect(member).toContain('bring an agent in only for a role your own part needs')
    // A member may invite: the rule never tells it to leave every addition to the leader.
    expect(member).not.toContain('instead of bringing agents in yourself')
    expect(
      buildCollaborationSection([TOOL.agents, TOOL.delegate], {
        withColleagues: false,
        isLeader: true,
      }),
    ).not.toContain('build the smallest useful team')
  })

  // A tag cannot grow a closed room; a bullet teaching one is advice the run can only fail at.
  test('a room whose membership is closed is told so instead of taught to bring agents in', () => {
    const open = buildCollaborationSection(all, { withColleagues: true })!
    const fixed = buildCollaborationSection(all, { withColleagues: true, membershipClosed: true })!
    expect(open).toContain('Bring in a suitable agent')
    expect(fixed).not.toContain('Bring in a suitable agent')
    expect(fixed).toContain('Nobody can be brought in or removed')
  })
})
