import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifySkillCall, createSkillTool } from './skill'
import type { DiscoveredSkill } from '../skill-discovery'

const run = (tool: ReturnType<typeof createSkillTool>, input: Record<string, unknown>) =>
  tool.execute('t', input as never)

describe('skill tool — validation (no filesystem)', () => {
  const tool = createSkillTool(null)

  test('save requires name, description, and content', async () => {
    expect((await run(tool, { action: 'save' })).isError).toBe(true)
    expect((await run(tool, { action: 'save', name: 'x' })).isError).toBe(true)
    expect((await run(tool, { action: 'save', name: 'x', description: 'd' })).isError).toBe(true)
  })

  test('get and delete require a name', async () => {
    expect((await run(tool, { action: 'get' })).isError).toBe(true)
    expect((await run(tool, { action: 'delete' })).isError).toBe(true)
  })

  test('an unknown action errors', async () => {
    expect((await run(tool, { action: 'bogus' })).isError).toBe(true)
  })
})

describe('skill tool — call classification', () => {
  test.each([
    ['list', { action: 'list' }, { effect: 'read' }],
    ['get', { action: 'get', name: 'x' }, { effect: 'read' }],
    ['save', { action: 'save', name: 'x' }, { effect: 'files' }],
    ['delete', { action: 'delete', name: 'x' }, { effect: 'files', irreversible: true }],
    // The old classifier read an unknown action as `read` — the one wrong direction.
    ['an unknown action', { action: 'bogus' }, { effect: 'external' }],
    ['no input', undefined, { effect: 'external' }],
  ] as const)('%s', (_label, input, expected) => {
    expect(classifySkillCall(input)).toEqual(expected)
    expect(createSkillTool(null).classify?.(input)).toEqual(expected)
    // Reads overlap the other calls of their turn; every write stays a barrier.
    expect(createSkillTool(null).executionModeFor?.(input)).toBe(
      expected.effect === 'read' ? 'parallel' : 'sequential',
    )
  })
})

describe('skill tool — project round-trip', () => {
  let dir: string
  const NAME = 'zz-skilltool-fixture'
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-tool-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('save → list → get → delete a project skill', async () => {
    const tool = createSkillTool(dir)

    const saved = await run(tool, {
      action: 'save',
      name: NAME,
      description: 'Fixture skill',
      content: 'STEP ONE marker',
    })
    expect(saved.isError).toBeUndefined()
    expect(saved.content).toContain('Skill saved')
    expect(saved.content).toContain('(project)')

    expect((await run(tool, { action: 'list' })).content).toContain(`/${NAME}`)
    expect((await run(tool, { action: 'get', name: NAME })).content).toContain('STEP ONE marker')

    expect((await run(tool, { action: 'delete', name: NAME })).content).toContain('Skill deleted')
    expect((await run(tool, { action: 'list' })).content ?? '').not.toContain(`/${NAME}`)
  })
})

// The tool wrote SKILL.md and announced nothing: the capability revision never moved, so the
// Skills list and the next run's "# Available skills" stayed stale until an unrelated toggle.
describe('skill tool — a save or delete announces the capability change', () => {
  let dir: string
  const NAME = 'zz-skilltool-announce'
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-tool-announce-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('save and delete each announce once; reads, refusals and misses do not', async () => {
    let announced = 0
    const tool = createSkillTool(dir, [], {}, '', () => announced++)

    await run(tool, { action: 'save', name: NAME, description: 'd', content: 'c' })
    expect(announced).toBe(1)
    await run(tool, { action: 'list' })
    await run(tool, { action: 'get', name: NAME })
    await run(tool, { action: 'save', name: NAME }) // refused: no description
    expect(announced).toBe(1)
    await run(tool, { action: 'delete', name: NAME })
    expect(announced).toBe(2)
    await run(tool, { action: 'delete', name: NAME }) // already gone
    expect(announced).toBe(2)
  })

  test('a throwing announcement never turns a written skill into an error', async () => {
    const tool = createSkillTool(dir, [], {}, '', () => {
      throw new Error('poke failed')
    })
    const saved = await run(tool, { action: 'save', name: NAME, description: 'd', content: 'c' })
    expect(saved.isError).toBeUndefined()
    expect((await run(tool, { action: 'delete', name: NAME })).isError).toBeUndefined()
  })
})

describe('skill tool — plugin skills are read-only', () => {
  test('deleting a plugin-provided skill is rejected with guidance', async () => {
    const extra = [
      {
        name: 'zz-plugin-skill',
        description: 'd',
        content: 'c',
        scope: 'global',
        path: '/x/SKILL.md',
        dir: '/x',
      },
    ] as unknown as DiscoveredSkill[]
    const tool = createSkillTool(null, extra)
    const res = await run(tool, { action: 'delete', name: 'zz-plugin-skill' })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('read-only')
  })
})

/**
 * The same tool against a real filesystem: save/get/list/delete, plugin-contributed
 * extras, and the curator usage tick. (Lived in a second skill.test.ts at the feature
 * root, orphaned when the tool moved into tools/.)
 */
describe('skill tool — filesystem', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'skilltool-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  describe('skill tool (filesystem)', () => {
    test('save writes a SKILL.md file and get retrieves its content', async () => {
      const tool = createSkillTool(dir)
      const saved = await tool.execute('t1', {
        action: 'save',
        name: 'deploy-staging',
        description: 'Deploy to staging',
        content: 'Run the deploy script.',
        scope: 'project',
      })
      expect(saved.content).toContain('Skill saved: "deploy-staging"')

      // The file exists on disk.
      const onDisk = await fs.readFile(join(dir, '.localix/skills/deploy-staging/SKILL.md'), 'utf8')
      expect(onDisk).toContain('name: deploy-staging')
      expect(onDisk).toContain('Run the deploy script.')

      const got = await tool.execute('t2', { action: 'get', name: 'deploy-staging' })
      expect(got.content).toContain('# Skill: deploy-staging')
      expect(got.content).toContain(
        `Resolve relative references from: ${JSON.stringify(
          join(dir, '.localix/skills/deploy-staging'),
        )}`,
      )
      expect(got.content).toEndWith('Run the deploy script.')
    })

    test('list shows saved skills, delete removes them', async () => {
      const tool = createSkillTool(dir)
      await tool.execute('t1', {
        action: 'save',
        name: 'a-skill',
        description: 'A',
        content: 'do a',
        scope: 'project',
      })
      const list = await tool.execute('t2', { action: 'list' })
      expect(list.content).toContain('/a-skill')

      const del = await tool.execute('t3', { action: 'delete', name: 'a-skill' })
      expect(del.content).toContain('Skill deleted')
      const after = await tool.execute('t4', { action: 'get', name: 'a-skill' })
      expect(after.content).toContain('not found')
    })

    test('get returns not found for a missing skill', async () => {
      const tool = createSkillTool(dir)
      const got = await tool.execute('t1', { action: 'get', name: 'nope' })
      expect(got.content).toContain('not found')
      expect(got.isError).toBe(true)
    })

    test('not-found error lists available skill names (self-healing), capped at 30', async () => {
      const extras = Array.from({ length: 35 }, (_, i) => ({
        name: `plugin-skill-${String(i).padStart(2, '0')}`,
        description: 'd',
        content: 'c',
        scope: 'global' as const,
        path: '/x/SKILL.md',
        dir: '/x',
      }))
      const tool = createSkillTool(dir, extras)
      const got = await tool.execute('t1', { action: 'get', name: 'nope' })
      expect(got.isError).toBe(true)
      // Host home dir may contribute real global skills, so assert the cap shape,
      // not exact boundary names.
      const text = String(got.content)
      expect(text).toContain('Available skills:')
      expect(text).toContain('plugin-skill-00')
      const match = text.match(/Available skills: (.+?) \(\+(\d+) more\)$/)
      expect(match).not.toBeNull()
      const shown = match![1].split(', ')
      expect(shown.length).toBe(30)
      expect(shown.length + Number(match![2])).toBeGreaterThanOrEqual(35)
    })
  })

  describe('skill tool (plugin-contributed extras)', () => {
    const pluginSkill = {
      name: 'frontend-design',
      description: 'Design guidance',
      content: 'Follow the design system.',
      scope: 'global' as const,
      path: '/plugins/frontend-design/SKILL.md',
      dir: '/plugins/frontend-design',
    }

    test('get resolves a plugin-contributed skill', async () => {
      const tool = createSkillTool(dir, [pluginSkill])
      const got = await tool.execute('t1', { action: 'get', name: 'frontend-design' })
      expect(got.isError).toBeUndefined()
      expect(got.content).toContain('Resolve relative references from: "/plugins/frontend-design"')
      expect(got.content).toEndWith('Follow the design system.')
    })

    test('list includes plugin-contributed skills', async () => {
      const tool = createSkillTool(dir, [pluginSkill])
      const list = await tool.execute('t1', { action: 'list' })
      expect(list.content).toContain('/frontend-design')
    })

    test('off hides a skill from list/get and blocks delete by a guessed name', async () => {
      const tool = createSkillTool(dir, [pluginSkill], { 'frontend-design': 'off' })

      expect((await tool.execute('t1', { action: 'list' })).content).not.toContain(
        '/frontend-design',
      )
      const saved = await tool.execute('t1-save', {
        action: 'save',
        name: 'frontend-design',
        description: 'Replacement',
        content: 'replacement',
      })
      expect(saved.isError).toBe(true)
      expect(saved.content).toBe('That skill name is unavailable.')

      const got = await tool.execute('t2', { action: 'get', name: 'frontend-design' })
      expect(got.isError).toBe(true)
      expect(got.content).toContain('not found')
      expect(got.content).not.toContain('Follow the design system')

      const deleted = await tool.execute('t3', { action: 'delete', name: 'frontend-design' })
      expect(deleted.isError).toBe(true)
      expect(deleted.content).toBe('Skill not found: "frontend-design".')
    })

    test('get turns a lazy body read failure into a tool error', async () => {
      const stale = { ...pluginSkill }
      Object.defineProperty(stale, 'content', {
        get: () => {
          throw new Error('SKILL.md disappeared')
        },
      })
      const tool = createSkillTool(dir, [stale])

      const got = await tool.execute('t1', { action: 'get', name: 'frontend-design' })
      expect(got.isError).toBe(true)
      expect(got.content).toContain('could not be loaded')
      expect(got.content).toContain('disappeared')
    })

    test('a filesystem skill wins over a plugin skill with the same name', async () => {
      const tool = createSkillTool(dir, [pluginSkill])
      await tool.execute('t1', {
        action: 'save',
        name: 'frontend-design',
        description: 'Local',
        content: 'Local override.',
        scope: 'project',
      })
      const got = await tool.execute('t2', { action: 'get', name: 'frontend-design' })
      expect(got.content).toEndWith('Local override.')
    })

    test('delete refuses a plugin-provided skill (read-only)', async () => {
      const tool = createSkillTool(dir, [pluginSkill])
      const del = await tool.execute('t1', { action: 'delete', name: 'frontend-design' })
      expect(del.isError).toBe(true)
      expect(del.content).toContain('plugin-provided')
      // Still retrievable.
      const got = await tool.execute('t2', { action: 'get', name: 'frontend-design' })
      expect(got.content).toEndWith('Follow the design system.')
    })
  })

  describe('skill tool (curator usage telemetry)', () => {
    test('get fires a usage tick; misses and other actions do not', async () => {
      const { setSkillUsageRecorder } = await import('../skill-usage-recorder')
      const ticks: Array<{ name: string; scope: string }> = []
      setSkillUsageRecorder((name, scope) => {
        ticks.push({ name, scope })
      })
      try {
        const tool = createSkillTool(dir)
        await tool.execute('t1', {
          action: 'save',
          name: 'tracked',
          description: 'T',
          content: 'do it',
          scope: 'project',
        })
        expect(ticks.length).toBe(0)

        await tool.execute('t2', { action: 'get', name: 'tracked' })
        expect(ticks).toEqual([{ name: 'tracked', scope: 'project' }])

        // A miss does not record usage.
        await tool.execute('t3', { action: 'get', name: 'missing-skill' })
        expect(ticks.length).toBe(1)

        // list does not record usage either.
        await tool.execute('t4', { action: 'list' })
        expect(ticks.length).toBe(1)
      } finally {
        setSkillUsageRecorder(null)
      }
    })

    test('a throwing sink never breaks get (best-effort)', async () => {
      const { setSkillUsageRecorder } = await import('../skill-usage-recorder')
      setSkillUsageRecorder(() => {
        throw new Error('db down')
      })
      try {
        const tool = createSkillTool(dir)
        await tool.execute('t1', {
          action: 'save',
          name: 's',
          description: 'S',
          content: 'body',
          scope: 'project',
        })
        const got = await tool.execute('t2', { action: 'get', name: 's' })
        expect(got.content).toEndWith('body')
        expect(got.isError).toBeUndefined()
      } finally {
        setSkillUsageRecorder(null)
      }
    })
  })
})

/**
 * `skill get` returned the body whole. The only ceiling on it is `MAX_SKILL_MARKDOWN_BYTES` (1 MiB) at
 * LOAD time, so one call could inject roughly a quarter of a million tokens into context — with no notice
 * that anything was large and no way to page it — while `read`, `search`, and
 * `tool_output` all cap at 64 KB with a numbered marker.
 */
describe('skill get is bounded and says so', () => {
  let dir = ''
  const NAME = 'huge-skill'
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-skill-cap-'))
  })
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('a long body is capped, marked with real counts, and points at the file', async () => {
    const tool = createSkillTool(dir)
    // The instructions lead, so the HEAD must survive and the tail must be what is cut.
    const body = `FIRST LINE MARKER\n${Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join('\n')}\nLAST LINE MARKER`
    await run(tool, { action: 'save', name: NAME, description: 'big', content: body })

    const got = await run(tool, { action: 'get', name: NAME })
    const text = String(got.content)
    expect(got.isError).toBeUndefined()
    expect(text).toContain('FIRST LINE MARKER')
    expect(text).not.toContain('LAST LINE MARKER')
    // Honest: real numbers plus an actionable next step, not a bare ellipsis.
    expect(text).toMatch(/truncated \d[\d,]* lines/)
    expect(text).toMatch(/of 20002 lines/)
    expect(text).toContain('read')
    // Provenance still leads the result, so relative references stay resolvable.
    expect(text).toContain('Resolve relative references from')
  })

  test('a short body carries no marker at all', async () => {
    const tool = createSkillTool(dir)
    await run(tool, { action: 'save', name: NAME, description: 'small', content: 'STEP ONE' })
    const text = String((await run(tool, { action: 'get', name: NAME })).content)
    expect(text).toContain('STEP ONE')
    expect(text).not.toContain('truncated')
  })
})
