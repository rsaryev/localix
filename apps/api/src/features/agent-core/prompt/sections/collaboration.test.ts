import { describe, expect, test } from 'bun:test'

import { buildCollaborationSection } from './collaboration'
import { TOOL } from '../../tool-names'

describe('# Collaboration', () => {
  test('the agent does the work itself and hands only side work to subagents', () => {
    const section = buildCollaborationSection([TOOL.Agent])!
    expect(section).toContain('Handle straightforward work directly')
    expect(section).toContain('Broad investigation goes to a subagent (`Agent`)')
    expect(section).toContain('Do a focused lookup yourself')
    expect(section).not.toMatch(/colleague|leader|participant|@mention/i)
  })

  // A child starts from its task alone and does not block the caller unless asked to.
  test('a subagent names its agent choice, clean context and background default', () => {
    const section = buildCollaborationSection([TOOL.Agent])!
    expect(section).toContain('`subagent_type` names a directory agent')
    expect(section).toContain('It sees only its prompt')
    expect(section).toContain('never poll for it or predict it')
    expect(section).toContain('Work a running subagent has already taken on is its')
  })

  test('without `Agent` there is nothing to decide, and no section', () => {
    expect(buildCollaborationSection([])).toBeNull()
    expect(buildCollaborationSection([TOOL.Store])).toBeNull()
  })

  test('creating a reusable specialist needs authoring, and ends by starting it with `Agent`', () => {
    const section = buildCollaborationSection([TOOL.Agent, TOOL.Store])!
    expect(section).toContain('Create a missing reusable specialist with `Store`')
    expect(section).toContain('only the user changes their permissions')
    expect(section).toContain('then start the created agent with `Agent`')
    expect(buildCollaborationSection([TOOL.Agent])).not.toContain('`Store`')
  })
})
