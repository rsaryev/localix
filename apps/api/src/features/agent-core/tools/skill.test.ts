import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifySkillCall, createSkillTool } from './skill'
import { skillToolInputSchema } from './skill-call'
import { testSavePorts, testSkillPorts } from '../testing/skill-ports'

const run = (tool: ReturnType<typeof createSkillTool>, input: Record<string, unknown>) =>
  tool.execute('t', input as never)

describe('skill tool — validation (no filesystem)', () => {
  const tool = createSkillTool(null)

  test('save requires name, description, and content', async () => {
    expect((await run(tool, { action: 'save' })).isError).toBe(true)
    expect((await run(tool, { action: 'save', name: 'x' })).isError).toBe(true)
    expect((await run(tool, { action: 'save', name: 'x', description: 'd' })).isError).toBe(true)
  })

  test('get requires a name', async () => {
    expect((await run(tool, { action: 'get' })).isError).toBe(true)
  })

  test('list and delete are gone: the Store lists and removes skills', async () => {
    for (const action of ['list', 'delete']) {
      expect(skillToolInputSchema.safeParse({ action, name: 'x' }).success).toBe(false)
      const result = await run(tool, { action, name: 'x' })
      expect(result.isError).toBe(true)
      expect(result.content).toContain('save, get')
    }
  })

  test('an unknown action errors', async () => {
    expect((await run(tool, { action: 'bogus' })).isError).toBe(true)
  })
})

describe('skill tool — call classification', () => {
  test.each([
    ['get', { action: 'get', name: 'x' }, { effect: 'read' }],
    ['save', { action: 'save', name: 'x' }, { effect: 'files' }],
    // Removed actions fall to the widest class, like any unknown one.
    ['list', { action: 'list' }, { effect: 'external' }],
    ['delete', { action: 'delete', name: 'x' }, { effect: 'external' }],
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

// The tool wrote SKILL.md and announced nothing: the capability revision never moved, so the
// Skills list and the next run's "# Available skills" stayed stale until an unrelated toggle.
describe('skill tool — a save announces the capability change', () => {
  let dir: string
  const NAME = 'zz-skilltool-announce'
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-tool-announce-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('a save announces once; reads and refusals do not', async () => {
    let announced = 0
    const tool = createSkillTool(dir, {}, '', () => announced++, testSavePorts(dir))

    await run(tool, { action: 'save', name: NAME, description: 'd', content: 'c' })
    expect(announced).toBe(1)
    await run(tool, { action: 'get', name: NAME })
    await run(tool, { action: 'save', name: NAME }) // refused: no description
    expect(announced).toBe(1)
  })

  test('a throwing announcement never turns a written skill into an error', async () => {
    const tool = createSkillTool(
      dir,
      {},
      '',
      () => {
        throw new Error('poke failed')
      },
      testSavePorts(dir),
    )
    const saved = await run(tool, { action: 'save', name: NAME, description: 'd', content: 'c' })
    expect(saved.isError).toBeUndefined()
  })
})

/**
 * The same tool against a real filesystem: save/get, plugin-contributed
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
    test("save hands the skill to the host's port, by scope; with no port it is refused", async () => {
      const ports = testSavePorts(dir)
      const tool = createSkillTool(dir, {}, '', undefined, ports)
      const draft = { name: 'deploy-staging', description: 'Deploy', content: 'Run it.' }
      const saved = await tool.execute('t1', { action: 'save', ...draft, scope: 'project' })
      expect(saved.content).toBe(
        `Skill saved: "deploy-staging" → ${dir}/project/skills/deploy-staging/SKILL.md (project)`,
      )
      await tool.execute('t2', { action: 'save', ...draft, scope: 'global' })
      // No project to hold it: the person's.
      await createSkillTool(null, {}, '', undefined, ports).execute('t3', {
        action: 'save',
        ...draft,
        scope: 'project',
      })
      expect(ports.saved.map((one) => one.scope)).toEqual(['project', 'global', 'global'])
      const refused = await createSkillTool(dir).execute('t4', { action: 'save', ...draft })
      expect(refused.isError).toBe(true)
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
        path: '/x/SKILL.md',
        dir: '/x',
      }))
      const tool = createSkillTool(dir, {}, '', undefined, testSkillPorts(extras))
      const got = await tool.execute('t1', { action: 'get', name: 'nope' })
      expect(got.isError).toBe(true)
      const text = String(got.content)
      expect(text).toContain('Available skills:')
      expect(text).toContain('plugin-skill-00')
      const match = text.match(/Available skills: (.+?) \(\+(\d+) more\)$/)
      expect(match).not.toBeNull()
      const shown = match![1].split(', ')
      expect(shown.length).toBe(30)
      expect(shown.length + Number(match![2])).toBe(35)
    })
  })

  describe('skill tool (plugin-contributed extras)', () => {
    const pluginSkill = {
      name: 'frontend-design',
      content: 'Follow the design system.',
      scope: 'global' as const,
      path: '/plugins/frontend-design/SKILL.md',
      dir: '/plugins/frontend-design',
    }

    test('get resolves a plugin-contributed skill', async () => {
      const tool = createSkillTool(dir, {}, '', undefined, testSkillPorts([pluginSkill]))
      const got = await tool.execute('t1', { action: 'get', name: 'frontend-design' })
      expect(got.isError).toBeUndefined()
      expect(got.content).toContain('Resolve relative references from: "/plugins/frontend-design"')
      expect(got.content).toEndWith('Follow the design system.')
    })

    test('off hides a skill from get and blocks a save over it by a guessed name', async () => {
      const tool = createSkillTool(
        dir,
        { 'frontend-design': 'off' },
        '',
        undefined,
        testSkillPorts([pluginSkill]),
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
    })

    test('get turns a lazy body read failure into a tool error', async () => {
      const stale = { ...pluginSkill }
      Object.defineProperty(stale, 'content', {
        get: () => {
          throw new Error('SKILL.md disappeared')
        },
      })
      const tool = createSkillTool(dir, {}, '', undefined, testSkillPorts([stale]))

      const got = await tool.execute('t1', { action: 'get', name: 'frontend-design' })
      expect(got.isError).toBe(true)
      expect(got.content).toContain('could not be loaded')
      expect(got.content).toContain('disappeared')
    })
  })

  describe('skill tool (curator usage telemetry)', () => {
    test('get fires a usage tick; misses and saves do not', async () => {
      const { setSkillUsageRecorder } = await import('../skill-usage-recorder')
      const ticks: Array<{ name: string; scope: string }> = []
      setSkillUsageRecorder((name, scope) => {
        ticks.push({ name, scope })
      })
      try {
        const tool = createSkillTool(
          dir,
          {},
          '',
          undefined,
          testSkillPorts([{ name: 'tracked', content: 'do it' }]),
        )
        await tool.execute('t1', {
          action: 'save',
          name: 'saved',
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
        const tool = createSkillTool(
          dir,
          {},
          '',
          undefined,
          testSkillPorts([{ name: 's', content: 'body' }]),
        )
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
 * `ToolOutput` all cap at 64 KB with a numbered marker.
 */
describe('skill get is bounded and says so', () => {
  const NAME = 'huge-skill'
  const sized = (content: string) =>
    createSkillTool(
      null,
      {},
      '',
      undefined,
      testSkillPorts([{ name: NAME, content, path: '/s/SKILL.md', dir: '/s' }]),
    )

  test('a long body is capped, marked with real counts, and points at the file', async () => {
    // The instructions lead, so the HEAD must survive and the tail must be what is cut.
    const body = `FIRST LINE MARKER\n${Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join('\n')}\nLAST LINE MARKER`
    const tool = sized(body)

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
    const tool = sized('STEP ONE')
    const text = String((await run(tool, { action: 'get', name: NAME })).content)
    expect(text).toContain('STEP ONE')
    expect(text).not.toContain('truncated')
  })
})
