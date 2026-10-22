import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { clientEvent, describeCommands, receiveDelivery, skillPrompt } from './conversation-events'
import { createEventCalls } from './event-calls'
import { hostWithMod } from './testing-host'

describe('the conversation’s events between turns', () => {
  test('skill.prompt rewrites a typed skill and the skill tool’s text', async () => {
    const { host, scope, scene } = await hostWithMod((on) => {
      on('skill.prompt', { skill: 'commit' }, ($, e: any) => ({ text: `${e.text} In haiku.` }))
    })
    expect(await skillPrompt(host, scene, 'commit', 'Write the commit.')).toBe(
      'Write the commit. In haiku.',
    )
    expect(await skillPrompt(host, scene, 'review', 'Review it.')).toBe('Review it.')
    const skill = defineAgentTool({
      name: 'skill',
      description: 'skill',
      activeVerb: 'Loading',
      inputSchema: z.object({}).passthrough(),
      execute: async () => ({ content: '# Skill: commit' }),
    }) as AgentTool
    const [wrapped] = scope.wrapTools([skill])
    expect((await wrapped!.execute('t1', { action: 'get', name: 'commit' })).content).toBe(
      '# Skill: commit In haiku.',
    )
  })

  test('session.receive rewrites a delivery, or consumes it', async () => {
    const { host } = await hostWithMod((on) => {
      on('session.receive', { origin: { kind: 'scheduled-trigger' } }, () => ({
        consumed: 'muted',
      }))
      on('session.receive', ($, e: any, next) => next({ ...e, text: e.text.toUpperCase() }))
    })
    const delivery = { userId: 'u', sessionId: 's1', text: 'build failed' }
    expect(await receiveDelivery(host, { ...delivery, source: 'external' })).toEqual({
      text: 'BUILD FAILED',
    })
    expect(await receiveDelivery(host, { ...delivery, source: 'loop' })).toEqual({
      consumed: 'muted',
    })
    // A conversation the mods never ran in hears nothing.
    expect(await receiveDelivery(host, { ...delivery, sessionId: 'other' })).toEqual({
      text: 'build failed',
    })
  })

  test('session.attach and session.detach follow a window', async () => {
    const seen: string[] = []
    const { host } = await hostWithMod((on) => {
      on('session.attach', ($, e: any, next) => (seen.push(`attach ${e.clientId}`), next(e)))
      on('session.detach', ($, e: any, next) => (seen.push(`detach ${e.reason}`), next(e)))
    })
    await clientEvent(host, { sessionId: 's1', clientId: 'desktop:1', attached: true })
    await clientEvent(host, { sessionId: 's1', clientId: 'desktop:1', attached: false })
    expect(seen).toEqual(['attach desktop:1', 'detach detach'])
  })

  test('command.describe relabels or hides a listed command', async () => {
    const { host } = await hostWithMod((on) => {
      on('command.describe', { command: 'old' }, ($, e, next) =>
        next({ ...(e as object), isHidden: true }),
      )
      on('command.describe', ($, e: any, next) => next({ ...e, description: `★ ${e.description}` }))
    })
    const listed = await describeCommands(host, [
      { name: 'old', description: 'Old', pluginName: 'p' },
      { name: 'new', description: 'New', pluginName: 'p' },
    ])
    expect(listed).toEqual([{ name: 'new', description: '★ New', pluginName: 'p' }])
  })

  test('$.prompt.compose composes from what the conversation’s latest turn composed', async () => {
    const { host, scope, scene } = await hostWithMod((on) => {
      on('prompt.section', { name: 'memory' }, () => ({ text: null }))
    })
    const calls = createEventCalls(() => host)
    await expect(calls.compose(scene, {})).rejects.toThrow('no system prompt was composed')
    await scope.composePrompt({
      sections: [
        { id: 'identity', text: 'You are Localix.' },
        { id: 'memory', text: 'Remembered.' },
      ],
      model: 'model-a',
      tools: [],
      outputStyle: null,
    })
    expect(await calls.compose(scene, {})).toEqual({
      sections: [{ id: 'identity', text: 'You are Localix.', scope: 'session' }],
    })
  })
})
