import { describe, expect, test } from 'bun:test'
import { testSessionSkill } from '../../plugins/kit/testing'
import { toSkillRecord, toSkillSummary } from './skills'

const row = (frontmatter = '', scope: 'user' | 'project' = 'project') =>
  testSessionSkill('deploy', frontmatter, { scope })

describe('toSkillRecord', () => {
  test("maps the kit's row with a file:<path> id; projectId only for a project skill", () => {
    expect(toSkillRecord(row(), 'proj-1')).toEqual({
      id: 'file:/skills/deploy/SKILL.md',
      name: 'deploy',
      description: 'About deploy',
      content: '',
      tags: [],
      projectId: 'proj-1',
      scope: 'project',
      source: 'file',
      path: '/skills/deploy/SKILL.md',
      updatedAt: '',
    })
    expect(toSkillRecord(row('', 'user'), 'proj-1').projectId).toBe('')
  })

  test('carries the invocation shape only where it differs from the default', () => {
    const record = toSkillRecord(
      row(
        'user-invocable: false\ndisable-model-invocation: true\nargument-hint: "[env]"\narguments: env',
      ),
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
