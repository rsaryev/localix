import { describe, expect, test } from 'bun:test'

import type { OutputStyle } from '@localixai/claude-plugin'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { sessionFixture } from '../../../testing/session-fixture'
import { handleControlCommand } from './command-handlers'
import type { SessionRecord } from '../repository'

const style = (name: string, extra: Partial<OutputStyle> = {}): OutputStyle => ({
  name,
  description: `${name} replies`,
  keepCodingInstructions: false,
  forceForPlugin: false,
  prompt: `Write ${name}.`,
  ...extra,
})

const plugin = (name: string, styles: OutputStyle[]) => ({
  plugin: {
    manifest: { name },
    entrypoints: { components: { outputStyles: styles } },
  },
})

const home = tempDirPerTest('output-style-home-')
const project = tempDirPerTest('output-style-project-')

async function run(
  prompt: string,
  enabled: unknown[],
  session = sessionFixture(),
  agentSettings: Record<string, unknown> | null = null,
) {
  const replies: string[] = []
  const writes: Array<Partial<SessionRecord>> = []
  const published: SessionRecord[] = []
  const ctx = {
    now: () => '2026-01-01T00:00:00.000Z',
    repo: {
      listMessages: async () => [],
      updateSession: async (_u: string, _s: string, patch: Partial<SessionRecord>) => {
        writes.push(patch)
      },
    },
    publishSession: (record: SessionRecord) => published.push(record),
    buildSessionPluginCatalog: async () => ({ enabled }),
    resolveSessionWorkingDir: async () => project(),
    homeDir: home(),
    deps: {
      ports: {
        userProfileRepo: {
          getRaw: async () =>
            agentSettings ? { agent_settings: JSON.stringify(agentSettings) } : null,
        },
      },
    },
    insertDirectReply: async (_u: string, sessionId: string, _p: string, text: string) => {
      replies.push(text)
      return { sessionId, messageId: 'm1' }
    },
  }
  await handleControlCommand(ctx as never, session.userId, session.id, session, prompt)
  return { replies, writes, published }
}

describe('/output-style', () => {
  const enabled = [plugin('my-plugin', [style('terse'), style('teacher')])]

  test('lists the default and every enabled plugin style, marking the current one', async () => {
    const session = { ...sessionFixture(), outputStyle: 'my-plugin:terse' }
    const { replies, writes } = await run('/output-style', enabled, session)
    expect(replies[0]).toContain('`default` — no style instructions')
    expect(replies[0]).toContain('`my-plugin:terse` — terse replies — current')
    expect(replies[0]).toContain('`my-plugin:teacher` — teacher replies')
    expect(writes).toEqual([])
  })

  test('switches the chat by name, ignoring case, and announces it', async () => {
    const { replies, writes, published } = await run('/output-style TERSE', enabled)
    expect(writes).toEqual([
      { outputStyle: 'my-plugin:terse', updatedAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(published[0]?.outputStyle).toBe('my-plugin:terse')
    expect(replies[0]).toContain('set to `my-plugin:terse`')
  })

  test('`default` is stored as an explicit choice of no style', async () => {
    const session = { ...sessionFixture(), outputStyle: 'my-plugin:terse' }
    const { writes } = await run('/output-style default', enabled, session)
    expect(writes[0]?.outputStyle).toBe('default')
  })

  test('offers the built-in styles and switches to one by any case', async () => {
    const listed = await run('/output-style', [])
    for (const name of ['Proactive', 'Concise', 'Explanatory', 'Learning'])
      expect(listed.replies[0]).toContain(`\`${name}\` — built-in`)
    const { writes } = await run('/output-style explanatory', [])
    expect(writes[0]?.outputStyle).toBe('Explanatory')
  })

  test("offers the person's and the project's styles, the project's winning a shared name", async () => {
    writeTree(home(), {
      '.localix/output-styles/mine.md': '---\ndescription: My voice\n---\nBe mine.',
      '.localix/output-styles/shared.md': 'From home.',
    })
    writeTree(project(), {
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.localix/output-styles/shared.md': '---\ndescription: Team voice\n---\nFrom the repo.',
    })
    const { replies } = await run('/output-style', [])
    expect(replies[0]).toContain('`mine` — yours · My voice')
    expect(replies[0]).toContain('`shared` — this project · Team voice')
    expect(replies[0]).not.toContain('From home')
  })

  test("marks the person's default as current in a chat that made no choice", async () => {
    const { replies } = await run('/output-style', [], sessionFixture(), {
      outputStyle: 'Concise',
    })
    expect(replies[0]).toContain('`Concise` — built-in')
    expect(replies[0]).toMatch(/`Concise` — built-in · [^\n]* — current/)
    expect(replies[0]).toContain('Chats without their own choice use `Concise`')
  })

  test('an unknown or ambiguous name changes nothing', async () => {
    const both = [...enabled, plugin('other', [style('terse')])]
    const ambiguous = await run('/output-style terse', both)
    expect(ambiguous.writes).toEqual([])
    expect(ambiguous.replies[0]).toContain('name one as `<plugin>:<name>`')
    const unknown = await run('/output-style shouty', enabled)
    expect(unknown.writes).toEqual([])
    expect(unknown.replies[0]).toContain('No output style "shouty"')
  })

  test('says when a forced plugin style still applies over the choice', async () => {
    const forced = [plugin('house', [style('house', { forceForPlugin: true })]), ...enabled]
    const { replies } = await run('/output-style my-plugin:teacher', forced)
    expect(replies[0]).toContain('`house:house` still applies while its plugin is enabled')
  })
})
