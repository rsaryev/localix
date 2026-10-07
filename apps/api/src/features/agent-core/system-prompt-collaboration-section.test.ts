import { describe, expect, test } from 'bun:test'

import { buildCollaborationSection } from './system-prompt-collaboration-section'
import { TOOL } from './tool-names'

const all = [TOOL.agents, TOOL.conversation_control]

describe('# Collaboration follows the room', () => {
  test('alone, the agent does the work itself and delegates substantial work', () => {
    const solo = buildCollaborationSection(all, { withColleagues: false })!
    expect(solo).toContain('Handle straightforward work directly')
    expect(solo).toContain('coordinate substantial work with suitable agents')
    expect(solo).toContain('keep its investigation out of this conversation')
    expect(solo).toContain('separate the user’s requirements from your proposed choices')
    expect(solo).toContain('newer correction supersedes conflicting earlier choices')
  })

  // Regression: @architect, not the leader, read "do the work yourself … delegate substantial
  // work" with @frontend and @qa already in the room, and sent both cards to one-shot children.
  test('with colleagues, a colleague’s part goes to them and delegation is the exception', () => {
    const room = buildCollaborationSection(all, { withColleagues: true })!
    expect(room).not.toContain('Handle straightforward work directly')
    expect(room).toContain('participant whose role owns it')
    expect(room).toContain('conversation_control')
    expect(room).toContain('only when no participant')
  })

  test('each bullet stays gated on the tool it names', () => {
    const room = buildCollaborationSection([TOOL.conversation_control], { withColleagues: true })!
    expect(room).not.toContain('action:"delegate"')
    expect(room).not.toContain('delegated run')
    expect(room).not.toContain('A brief must')
    const solo = buildCollaborationSection([TOOL.agents], { withColleagues: false })!
    expect(solo).toContain('action:"delegate"')
    expect(solo).not.toContain('conversation_control')
    expect(buildCollaborationSection([], { withColleagues: true })).toBeNull()
  })

  // The membership writer refuses an invitation in a fixed room; a bullet teaching one is
  // advice the run can only fail at.
  test('a room whose participants are fixed is told so instead of taught to invite', () => {
    const open = buildCollaborationSection(all, { withColleagues: true })!
    const fixed = buildCollaborationSection(all, { withColleagues: true, rosterLocked: true })!
    expect(open).toContain('Invite a colleague')
    expect(fixed).not.toContain('Invite a colleague')
    expect(fixed).toContain('nobody can be invited or removed')
  })
})
