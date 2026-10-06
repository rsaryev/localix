import { expect, spyOn, test } from 'bun:test'
import { pluginTerminal } from '@localixai/plugin-sdk/ui'
import type { PluginTranscriptInput } from '@localixai/plugin-sdk/ui/runtime'
import { openExternalAgentSession, type ExternalAgentSessionSource } from './openSession'

const source: ExternalAgentSessionSource = {
  provider: 'codex',
  nativeSessionId: 'native-123',
  key: 'codex:native-123',
  uri: 'localix://resource/external-agent/codex/native-123',
  title: 'Foreign session',
}
const items = { key: source.key, turns: [], withheld: 0, total: 0 }
const resume = { providerName: 'Codex', command: "cd -- '/work/acme' && codex resume 'native-123'" }

test('keeps import and adds a separate native terminal action in the owning chat', async () => {
  let transcript: PluginTranscriptInput | undefined
  const spawned: unknown[] = []
  let imports = 0
  await openExternalAgentSession(
    'chat-a',
    source,
    async () => ({ ...items, resume }),
    async () => {
      imports += 1
      return { id: 'imported', projectId: 'project' }
    },
    (input) => {
      transcript = input
    },
    async (request) => {
      spawned.push(request)
      return { terminalId: 'terminal' }
    },
  )
  expect(transcript?.actions?.map((action) => action.label)).toEqual([
    'Import to Localix',
    'Open in Codex',
  ])
  expect(spawned).toEqual([])
  expect(await transcript?.actions?.[1]?.run()).toBeUndefined()
  expect(spawned).toEqual([{ sessionId: 'chat-a', command: resume.command, title: 'Codex' }])
  expect(imports).toBe(0)
  expect(await transcript?.actions?.[0]?.run()).toEqual({
    sessionId: 'imported',
    projectId: 'project',
  })
  expect(imports).toBe(1)
})

test('does not offer a native launch when the adapter has no resume command', async () => {
  let transcript: PluginTranscriptInput | undefined
  await openExternalAgentSession(
    'chat-a',
    source,
    async () => items,
    undefined,
    (input) => {
      transcript = input
    },
  )
  expect(transcript?.action?.label).toBe('Import to Localix')
  expect(transcript?.actions).toBeUndefined()
})

test('reveals an existing agent terminal instead of starting a duplicate', async () => {
  let transcript: PluginTranscriptInput | undefined
  const open = spyOn(pluginTerminal, 'openJob').mockImplementation(() => {})
  const spawn = spyOn(pluginTerminal, 'spawnCommand')
  try {
    await openExternalAgentSession(
      'chat-a',
      { ...source, terminalId: 'live-terminal' },
      async () => ({ ...items, resume }),
      undefined,
      (input) => {
        transcript = input
      },
    )
    await transcript?.actions?.[1]?.run()
    expect(open).toHaveBeenCalledWith({
      sessionId: 'chat-a',
      terminalId: 'live-terminal',
      title: 'Codex',
    })
    expect(spawn).not.toHaveBeenCalled()
  } finally {
    open.mockRestore()
    spawn.mockRestore()
  }
})
