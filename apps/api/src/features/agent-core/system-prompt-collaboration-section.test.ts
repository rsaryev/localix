import { describe, expect, test } from 'bun:test'

import { buildCollaborationSection } from './system-prompt-collaboration-section'
import { TOOL } from './tool-names'

const all = [TOOL.fork]
const chat = { inConversation: true }

describe('# Collaboration follows the room', () => {
  test('alone, the agent does the work itself and forks only side work', () => {
    const solo = buildCollaborationSection(all, { withColleagues: false, ...chat })!
    expect(solo).toContain('Handle straightforward work directly')
    expect(solo).toContain('Investigation goes to `fork`')
    expect(solo).toContain('act on its short report')
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

  // Agents no longer hand work to other agents: no wording may teach it, in any room.
  test('no room is taught to delegate to another agent', () => {
    for (const withColleagues of [false, true]) {
      const section = buildCollaborationSection(all, { withColleagues, ...chat })!
      expect(section).not.toContain('`agents`')
      expect(section).not.toContain('action:"delegate"')
      expect(section).not.toMatch(/\bdelegat/i)
    }
  })

  test('each bullet stays gated on what the run can do', () => {
    const room = buildCollaborationSection([], { withColleagues: true })!
    expect(room).not.toContain('`fork`')
    expect(room).not.toContain('running fork')
    const job = buildCollaborationSection([TOOL.fork], { withColleagues: false })!
    expect(job).toContain('`fork`')
    expect(job).not.toContain('Bring in')
    // No fork, no conversation to grow, no colleagues: nothing to decide.
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
    expect(member).toContain('Report missing expertise to the leader')
    expect(
      buildCollaborationSection([TOOL.agents, TOOL.fork], {
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
