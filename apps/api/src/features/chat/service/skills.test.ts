import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { makeTempDir } from '@localixai/testing'
import { join } from 'node:path'
import { toFileSkillRecord } from './skills'
import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import { discoverFilesystemSkills, writeSkillFile } from '../../agent-core/skill-discovery'

const skill = (over: Partial<DiscoveredSkill> = {}): DiscoveredSkill =>
  ({
    path: '/s/SKILL.md',
    name: 'deploy',
    description: 'd',
    content: 'do it',
    scope: 'project',
    ...over,
  }) as DiscoveredSkill

describe('toFileSkillRecord', () => {
  test('maps core fields with a file:<path> id and source', () => {
    const r = toFileSkillRecord(skill(), 'proj-1')
    expect(r).toMatchObject({
      id: 'file:/s/SKILL.md',
      name: 'deploy',
      description: 'd',
      content: 'do it',
      source: 'file',
      scope: 'project',
      path: '/s/SKILL.md',
      tags: [],
    })
  })

  test('forwards content lazily so roster lookup does not materialize every body', () => {
    let reads = 0
    const discovered = skill()
    Object.defineProperty(discovered, 'content', {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1
        return 'loaded on demand'
      },
    })

    const record = toFileSkillRecord(discovered, 'proj-1')
    expect(reads).toBe(0)
    expect(typeof Object.getOwnPropertyDescriptor(record, 'content')?.get).toBe('function')
    expect(record.content).toBe('loaded on demand')
    expect(reads).toBe(1)
  })

  test('projectId only set for project scope; global scope is empty', () => {
    expect(toFileSkillRecord(skill({ scope: 'project' }), 'proj-1').projectId).toBe('proj-1')
    expect(toFileSkillRecord(skill({ scope: 'global' }), 'proj-1').projectId).toBe('')
  })

  test('CC fields are included only when set', () => {
    const bare = toFileSkillRecord(skill(), 'p')
    expect(bare.disableModelInvocation).toBeUndefined()
    expect(bare.argumentNames).toBeUndefined()
    expect(bare.contextFork).toBeUndefined()

    const rich = toFileSkillRecord(
      skill({
        disableModelInvocation: true,
        userInvocable: false,
        argumentNames: ['a', 'b'],
        allowedTools: ['read'],
        contextFork: true,
        preferredModel: 'm',
      }),
      'p',
    )
    expect(rich).toMatchObject({
      disableModelInvocation: true,
      userInvocable: false,
      argumentNames: ['a', 'b'],
      allowedTools: ['read'],
      contextFork: true,
      preferredModel: 'm',
    })
  })

  test('empty CC arrays are omitted (not stored as [])', () => {
    const r = toFileSkillRecord(skill({ argumentNames: [], allowedTools: [] }), 'p')
    expect(r.argumentNames).toBeUndefined()
    expect(r.allowedTools).toBeUndefined()
  })
})

/**
 * The write path is the SAME choke point for the Settings UI (`createSkill`) and for
 * the agent's `skill` tool: both funnel into `writeSkillFile`. It USED to render the
 * frontmatter from scratch with `name` + `description` only, so any edit that carried
 * just those two fields — which is all `SkillInput` can express — silently and
 * permanently deleted every other frontmatter key the SKILL.md carried.
 *
 * Temp dirs live INSIDE the workspace on purpose: writes under `/tmp` trip the
 * sandbox's approval prompt and hang an unattended run.
 */
const tmpBase = async (label: string): Promise<string> => makeTempDir(`localix-${label}`)

describe('writeSkillFile — frontmatter is preserved, not rebuilt', () => {
  test('an edit that changes only the description keeps every other frontmatter key', async () => {
    const base = await tmpBase('skill-edit')
    try {
      const dir = join(base, '.localix/skills/deploy')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        join(dir, 'SKILL.md'),
        [
          '---',
          'name: deploy',
          'description: old description',
          'argument-hint: "[env]"',
          'user-invocable: false',
          'allowed-tools: Bash(git *) Read',
          'version: 2.1.0',
          '---',
          '',
          'Deploy to $1.',
          '',
        ].join('\n'),
        'utf8',
      )

      // Exactly what the Settings UI sends when you retype the description: a
      // SkillInput, which carries name + description + content and nothing else.
      await writeSkillFile(
        base,
        {
          name: 'deploy',
          description: 'new description',
          content: 'Deploy to $1.',
        },
        'project',
      )

      const [found] = await discoverFilesystemSkills(base, join(base, 'nohome'))
      expect(found.description).toBe('new description')
      expect(found.argumentHint).toBe('[env]')
      expect(found.userInvocable).toBe(false)
      expect(found.allowedTools).toEqual(['Bash(git *)', 'Read'])
      expect(found.version).toBe('2.1.0')
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })

  test('frontmatter keys the model does not know about survive too', async () => {
    const base = await tmpBase('skill-unmodelled')
    try {
      const dir = join(base, '.localix/skills/deploy')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        join(dir, 'SKILL.md'),
        [
          '---',
          'name: deploy',
          'description: old',
          'license: Apache-2.0',
          'x-team: platform',
          'metadata:',
          '  owner: infra',
          '---',
          '',
          'body',
          '',
        ].join('\n'),
        'utf8',
      )

      await writeSkillFile(base, { name: 'deploy', description: 'new', content: 'body' }, 'project')

      const raw = await fs.readFile(join(dir, 'SKILL.md'), 'utf8')
      expect(raw).toContain('description: new')
      expect(raw).not.toContain('description: old')
      // Keys we do not model at all are still knowledge in the file. Dropping them
      // is the same data-loss bug one level down.
      expect(raw).toContain('license: Apache-2.0')
      expect(raw).toContain('x-team: platform')
      expect(raw).toContain('metadata:')
      expect(raw).toContain('  owner: infra')
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })

  test('a foreign .claude skill is ignored and a Localix skill is written to .localix', async () => {
    const base = await tmpBase('skill-claude')
    try {
      const dir = join(base, '.claude/skills/deploy')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(
        join(dir, 'SKILL.md'),
        '---\nname: deploy\ndescription: old\nversion: 9\n---\n\nbody\n',
        'utf8',
      )

      await writeSkillFile(base, { name: 'deploy', description: 'new', content: 'body' }, 'project')

      const foreign = await fs.readFile(join(dir, 'SKILL.md'), 'utf8')
      expect(foreign).toContain('description: old')
      expect(foreign).toContain('version: 9')
      const local = await fs.readFile(join(base, '.localix/skills/deploy/SKILL.md'), 'utf8')
      expect(local).toContain('description: new')
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })

  test('a brand-new skill gets the canonical .localix/skills path and minimal frontmatter', async () => {
    const base = await tmpBase('skill-new')
    try {
      const dir = await writeSkillFile(
        base,
        { name: 'fresh', description: 'a\tb\nc', content: '  body  ' },
        'global',
      )
      expect(dir).toBe(join(base, '.localix/skills/fresh'))
      const raw = await fs.readFile(join(dir, 'SKILL.md'), 'utf8')
      // Newlines/tabs collapse — YAML frontmatter values here are single-line.
      expect(raw).toBe('---\nname: fresh\ndescription: a b c\n---\n\nbody\n')
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })
})
