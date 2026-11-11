/**
 * Claude Code's built-in commands that Localix runs through what it already has, as a person
 * meets them: the reply in the chat, and the effect on the session.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSync, scratchGitEnv, tempDirPerTest } from '@localixai/testing'

import { hookTestSession } from '../../plugins/kit/testing'
import type { SessionRecord } from '../repository'
import { handleControlCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'

const session = {
  id: 's1',
  userId: 'u',
  title: 'Chat',
  agent: { agentId: 'lead' },
} as unknown as SessionRecord

const root = tempDirPerTest('claude-code-commands-')

function harness(extra: Record<string, unknown> = {}) {
  const replies: string[] = []
  const checkpoints: unknown[][] = []
  const macros: unknown[][] = []
  const ctx = {
    runMacroCommand: async (...args: unknown[]) => {
      macros.push(args)
      return { sessionId: 's1', messageId: 'macro' }
    },
    repo: { listMessages: async () => [] },
    resolveSessionWorkingDir: async () => root(),
    buildSessionPluginCatalog: async () => ({ enabled: [] }),
    runner: {
      isBusy: () => false,
      requestCheckpoint: (...args: unknown[]) => checkpoints.push(args),
    },
    now: () => '2026-01-01T00:00:00.000Z',
    insertDirectReply: async (_u: string, sessionId: string, _p: string, text: string) => {
      replies.push(text)
      return { sessionId, messageId: 'reply' }
    },
    ...extra,
  } as unknown as CommandHandlerContext
  const run = (prompt: string) => handleControlCommand(ctx, 'u', session.id, session, prompt)
  return { run, replies, checkpoints, macros }
}

describe('/compact', () => {
  test('asks the agent of the chat for a checkpoint on its next turn, with the instructions', async () => {
    const h = harness()
    await h.run('/compact keep the  plan and the open questions')
    expect(h.checkpoints).toEqual([['s1', 'keep the plan and the open questions']])
    expect(h.replies[0]).toContain('next message')
    expect(h.replies[0]).toContain('PreCompact')
  })

  test('without instructions it still compacts, and says nothing about hooks', async () => {
    const h = harness()
    await h.run('/compact')
    expect(h.checkpoints).toEqual([['s1', '']])
    expect(h.replies[0]).not.toContain('PreCompact')
  })
})

describe('/init', () => {
  test('starts an ordinary agent turn that writes CLAUDE.md, shown as the typed command', async () => {
    const h = harness()
    await h.run('/init')
    const [, , , , visible, instruction] = h.macros[0] as string[]
    expect(visible).toBe('/init')
    expect(instruction).toContain('CLAUDE.md')
    expect(instruction).toContain('@AGENTS.md')
  })
})

describe('/add-dir', () => {
  test('remembers an existing folder in the project’s local settings, and refuses a missing one', async () => {
    const h = harness()
    const shared = join(root(), 'shared')
    mkdirSync(shared)
    await h.run(`/add-dir ${shared}`)
    await h.run('/add-dir nowhere')
    const file = join(root(), '.claude', 'settings.local.json')
    expect(JSON.parse(readFileSync(file, 'utf8')).permissions.additionalDirectories).toEqual([
      shared,
    ])
    expect(h.replies[1]).toContain('is not a folder')
  })
})

describe('/status and /hooks', () => {
  test('/status names the chat, its folder and mode', async () => {
    const h = harness()
    await h.run('/status')
    expect(h.replies[0]).toContain('Chat:')
    expect(h.replies[0]).toContain(`\`${root()}\``)
  })

  test("/hooks lists the session's hooks by event, once the chat has run", async () => {
    const before = harness({ deps: {} })
    await before.run('/hooks')
    expect(before.replies[0]).toContain('once it has run')
    const session = hookTestSession(root(), root(), {
      Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
    })
    const after = harness({ deps: { pluginSessions: { get: () => session } } })
    await after.run('/hooks')
    expect(after.replies[0]).toContain('**Stop**')
    expect(after.replies[0]).toContain('(user settings)')
  })
})

describe('/diff and /export', () => {
  test('/diff shows a changed file of the folder’s repository', async () => {
    const h = harness()
    writeFileSync(join(root(), 'a.txt'), 'one\n')
    const git = (...args: string[]) => runSync('git', args, { cwd: root(), env: scratchGitEnv() })
    git('init', '-q')
    git('add', '.')
    git('commit', '-qm', 'x')
    writeFileSync(join(root(), 'a.txt'), 'two\n')
    await h.run('/diff')
    expect(h.replies[0]).toContain('+two')
  })

  test('/export writes the conversation to the named file in the folder', async () => {
    const h = harness({
      repo: {
        listMessages: async () => [
          { id: '1', createdAt: '', payload: { role: 'user', content: 'hello there' } },
        ],
      },
    })
    await h.run('/export out/chat')
    const file = join(root(), 'out', 'chat.md')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('hello there')
    await h.run('/export out/chat')
    expect(h.replies[1]).toContain('already exists')
  })
})

describe('a command that works in the folder, when the folder moved', () => {
  test('/diff and /add-dir refuse as every folder-bound read does, rather than report no repository', async () => {
    const gone = join(root(), 'moved-away')
    const h = harness({ resolveSessionWorkingDir: async () => gone })
    for (const command of ['/diff', `/add-dir ${root()}`]) {
      await expect(h.run(command)).rejects.toMatchObject({
        status: 409,
        code: 'workspace_folder_missing',
        detail: gone,
      })
    }
    expect(h.replies).toEqual([])
  })
})
