/** `/status`: what this chat runs on, in one reply a person can read at a glance. */
import { describe, expect, test } from 'bun:test'

import { formatStatus, type StatusFacts } from './command-status'

const facts: StatusFacts = {
  title: 'Fix login',
  sessionId: 'sess-1',
  cwd: '/work/app',
  permissionMode: 'plan',
  agent: { name: 'lead', modelId: 'sonnet', reasoningEffort: 'high' },
  addedDirs: ['/srv/shared'],
  plugins: ['review', 'deploy'],
  claudeCodeVersion: '2.1.310',
}

describe('/status', () => {
  test('names the chat, folder, mode, agent with its model, folders and plugins', () => {
    const text = formatStatus(facts)
    expect(text).toContain('Fix login')
    expect(text).toContain('`sess-1`')
    expect(text).toContain('`/work/app`')
    expect(text).toContain('Plan')
    expect(text).toContain('`@lead`: `sonnet`, reasoning high')
    expect(text).toContain('`/srv/shared`')
    expect(text).toContain('review, deploy')
    expect(text).toContain('2.1.310')
  })

  test('says when the agent has no model yet', () => {
    const text = formatStatus({
      ...facts,
      agent: { name: 'qa', modelId: '', reasoningEffort: 'medium' },
    })
    expect(text).toContain('`@qa`: no model chosen')
  })

  test('leaves out what there is none of, rather than printing empty rows', () => {
    const text = formatStatus({ ...facts, addedDirs: [], plugins: [] })
    expect(text).not.toContain('Added folders')
    expect(text).not.toContain('Plugins')
  })
})
