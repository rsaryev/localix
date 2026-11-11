import { describe, expect, test } from 'bun:test'
import type { ChatSkill } from '../../plugins/kit'
import { toSkillRecord, toSkillSummary } from './skills'

const row = (over: Partial<ChatSkill> = {}): ChatSkill => ({
  name: 'deploy',
  names: ['deploy'],
  ownName: 'deploy',
  kind: 'skill',
  description: 'd',
  argumentNames: [],
  userInvocable: true,
  modelInvocable: true,
  inMenu: true,
  listed: 'full' as ChatSkill['listed'],
  dormant: false,
  override: 'on' as ChatSkill['override'],
  scope: 'project',
  path: '/s/SKILL.md',
  ...over,
})

describe('toSkillRecord', () => {
  test("maps the kit's row with a file:<path> id; projectId only for a project skill", () => {
    expect(toSkillRecord(row(), 'proj-1')).toEqual({
      id: 'file:/s/SKILL.md',
      name: 'deploy',
      description: 'd',
      content: '',
      tags: [],
      projectId: 'proj-1',
      scope: 'project',
      source: 'file',
      path: '/s/SKILL.md',
      updatedAt: '',
    })
    expect(toSkillRecord(row({ scope: 'global' }), 'proj-1').projectId).toBe('')
  })

  test('carries the invocation shape only where it differs from the default', () => {
    const record = toSkillRecord(
      row({
        userInvocable: false,
        modelInvocable: false,
        argumentHint: '[env]',
        argumentNames: ['env'],
      }),
      'p',
      { content: 'body', validation: { errors: [], warnings: ['w'] } },
    )
    expect(toSkillSummary(record)).toMatchObject({
      disableModelInvocation: true,
      userInvocable: false,
      argumentHint: '[env]',
      argumentNames: ['env'],
      validation: { errors: [], warnings: ['w'] },
    })
    expect(record.content).toBe('body')
  })
})
