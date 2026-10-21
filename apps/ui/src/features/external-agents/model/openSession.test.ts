import { afterEach, expect, mock, spyOn, test } from 'bun:test'
import { externalAgentsApi } from '../api'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import { useChatStore } from '@/features/chat/model/store'
import { inspector } from '@/shared/lib/inspectorBus'
import { openExternalSessionTerminal, prepareExternalTranscript } from './openSession'
import { readTranscript, forgetTranscripts } from '@/features/chat/model/openTranscript'
import { backendClient } from '@/shared/api/client'
import { composerBus } from '@/shared/lib/composerBus'

afterEach(() => forgetTranscripts(new Set()))

test('preview creates no chat; its explicit link attaches a canonical resource to its own chat', async () => {
  const items = spyOn(externalAgentsApi, 'items').mockResolvedValue({
    key: 'codex:s1',
    turns: [],
    total: 2200,
    withheld: 200,
    resume: undefined,
  })
  const create = spyOn(backendClient, 'createSession')
  const imported = spyOn(backendClient, 'importSession')
  const insert = spyOn(composerBus, 'insert').mockImplementation(() => {})
  try {
    const id = await prepareExternalTranscript(
      { key: 'codex:s1', provider: 'codex', title: 'Parser review', cwd: '/work/project' },
      'own-chat',
    )
    expect(create).not.toHaveBeenCalled()
    expect(imported).not.toHaveBeenCalled()
    expect(items.mock.calls[0]).toEqual(['codex:s1', 2000, true])
    const transcript = readTranscript(id)!
    expect(transcript.messages[0]?.content).toContain('200 earlier events')
    expect(transcript.actions?.map((action) => action.label)).toEqual(['Link to chat'])
    await transcript.actions![0]!.run()
    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'own-chat',
      bindings: [
        {
          kind: 'context',
          target: { kind: 'resource', uri: 'localix://resource/external-agent/codex/s1' },
        },
      ],
      focus: false,
    })
  } finally {
    items.mockRestore()
    create.mockRestore()
    imported.mockRestore()
    insert.mockRestore()
  }
})

test('existing native sessions open their normal linked chat and owned CLI terminal without importing', async () => {
  const attach = spyOn(externalAgentsApi, 'attachNative').mockResolvedValue({
    sessionId: 'linked-chat',
    projectId: 'project-1',
  })
  const open = spyOn(externalAgentsApi, 'openOwned').mockResolvedValue({
    terminalId: 'pty',
    providerName: 'Codex',
  })
  const terminal = mock((_sessionId: string, _terminalId: string, _title: string) => {})
  const unregister = terminalBus.setOwnedOpener(terminal)
  const items = spyOn(externalAgentsApi, 'items')
  const imported = spyOn(backendClient, 'importSession')
  const create = spyOn(backendClient, 'createSession')
  const reload = spyOn(useChatStore.getState(), 'loadProjects').mockResolvedValue()
  try {
    const result = await openExternalSessionTerminal(
      { key: 'codex:s1', provider: 'codex', title: 'Review' },
      'unrelated-chat',
    )
    expect(result).toEqual({ sessionId: 'linked-chat', projectId: 'project-1' })
    expect(attach).toHaveBeenCalledWith('codex:s1')
    expect(open).toHaveBeenCalledWith('linked-chat')
    expect(terminal).toHaveBeenCalledWith('linked-chat', 'pty', 'Codex')
    expect(items).not.toHaveBeenCalled()
    expect(imported).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  } finally {
    for (const spy of [attach, open, items, imported, create, reload]) spy.mockRestore()
    unregister()
  }
})

test('a missing native session never opens a different terminal or a preview', async () => {
  const attach = spyOn(externalAgentsApi, 'attachNative').mockRejectedValue(
    new Error('Session missing'),
  )
  const open = spyOn(externalAgentsApi, 'openOwned')
  const preview = spyOn(inspector, 'openWorkItem').mockImplementation(() => {})
  try {
    await expect(
      openExternalSessionTerminal({ key: 'codex:s1', provider: 'codex', title: 'Review' }, null),
    ).rejects.toThrow('Session missing')
    expect(open).not.toHaveBeenCalled()
    expect(preview).not.toHaveBeenCalled()
  } finally {
    for (const spy of [attach, open, preview]) spy.mockRestore()
  }
})
