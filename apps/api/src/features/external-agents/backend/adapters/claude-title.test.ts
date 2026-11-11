import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { summarizeClaudeCode } from './claude-summary'

/**
 * Which title a Claude Code session is listed under. Claude Code's own picker shows "the session name
 * if you set one, otherwise the AI-generated session title … or first prompt" (code.claude.com/docs/
 * en/sessions.md). A name set with `/rename` is a `custom-title` record, rewritten beside the
 * `ai-title` one every turn; the list showed the generated title over the name the person chose.
 */
const dir = tempDirPerTest('ea-claude-title')
const SESSION = '00000000-0000-7000-8000-0000000000c1'

function transcript(records: readonly object[]) {
  const path = join(dir(), `${SESSION}.jsonl`)
  writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`)
  return summarizeClaudeCode({ nativeSessionId: SESSION, sourcePath: path, revision: '1|1' })
}

const opening = {
  type: 'user',
  uuid: 'u1',
  cwd: '/work/app',
  timestamp: '2026-08-01T10:00:00.000Z',
  message: { role: 'user', content: 'Fix the parser' },
}

describe('a Claude Code session title', () => {
  test('a name the person set wins over the generated title', async () => {
    const summary = await transcript([
      opening,
      { type: 'custom-title', customTitle: 'parser-rewrite', sessionId: SESSION },
      { type: 'ai-title', aiTitle: 'Fix parser bugs', sessionId: SESSION },
      { type: 'agent-name', agentName: 'parser-rewrite', sessionId: SESSION },
    ])
    expect(summary.title).toBe('parser-rewrite')
  })

  test('the latest name wins when it was changed', async () => {
    const summary = await transcript([
      opening,
      { type: 'custom-title', customTitle: 'first-name', sessionId: SESSION },
      { type: 'custom-title', customTitle: 'second-name', sessionId: SESSION },
    ])
    expect(summary.title).toBe('second-name')
  })

  test('without a name the generated title, and without that the first prompt', async () => {
    const generated = await transcript([
      opening,
      { type: 'ai-title', aiTitle: 'Fix parser bugs', sessionId: SESSION },
    ])
    expect(generated.title).toBe('Fix parser bugs')
    expect((await transcript([opening])).title).toBe('Fix the parser')
  })
})

/**
 * Measured on a real history: 22 of 449 sessions were listed under a tag (`<command-message>…`,
 * `<local-command-stdout>…`) and 26 under their UUID, because every prompt in their head was a slash
 * command — which the head skipped as bookkeeping and nothing replaced.
 */
describe('a session opened by a slash command', () => {
  const command = (name: string, args = '') => ({
    ...opening,
    message: {
      role: 'user',
      content: `<command-message>${name.slice(1)}</command-message>\n<command-name>${name}</command-name>\n<command-args>${args}</command-args>`,
    },
  })
  const output = {
    ...opening,
    message: {
      role: 'user',
      content: '<local-command-stdout>Set model to opus</local-command-stdout>',
    },
  }

  test('the first typed prompt still wins over the commands before it', async () => {
    const summary = await transcript([command('/model'), output, { ...opening, uuid: 'u2' }])
    expect(summary.title).toBe('Fix the parser')
  })

  test('with no typed prompt, the command and its arguments name it', async () => {
    const summary = await transcript([command('/model'), output, command('/review', 'PR 12')])
    expect(summary.title).toBe('/review PR 12')
  })

  test('with only bare commands, the first one names it rather than its id', async () => {
    expect((await transcript([command('/usage'), output])).title).toBe('/usage')
  })
})
