import { afterEach, expect, spyOn, test } from 'bun:test'
import { externalAgentsApi } from '../api'
import { prepareExternalTranscript } from './openSession'
import { readTranscript, forgetTranscripts } from '@/features/chat/model/openTranscript'
import { backendClient } from '@/shared/api/client'
import { composerBus } from '@/shared/lib/composerBus'

afterEach(() => forgetTranscripts(new Set()))

test('preview creates no chat; its explicit link attaches a canonical resource to its own chat', async () => {
  const items = spyOn(externalAgentsApi, 'items').mockResolvedValue({ key: 'codex:s1', turns: [], total: 2200, withheld: 200, resume: undefined })
  const create = spyOn(backendClient, 'createSession')
  const imported = spyOn(backendClient, 'importSession')
  const insert = spyOn(composerBus, 'insert').mockImplementation(() => {})
  try {
    const id = await prepareExternalTranscript({ key: 'codex:s1', provider: 'codex', title: 'Parser review', cwd: '/work/project' }, 'own-chat')
    expect(create).not.toHaveBeenCalled()
    expect(imported).not.toHaveBeenCalled()
    expect(items.mock.calls[0]).toEqual(['codex:s1', 2000, true])
    const transcript = readTranscript(id)!
    expect(transcript.messages[0]?.content).toContain('200 earlier events')
    expect(transcript.actions?.map((action) => action.label)).toEqual(['Link to chat', 'Import to Localix'])
    await transcript.actions![0]!.run()
    expect(insert.mock.calls[0]?.[0]).toMatchObject({ sessionId: 'own-chat', bindings: [{ kind: 'context', target: { kind: 'resource', uri: 'localix://resource/external-agent/codex/s1' } }], focus: false })
  } finally { items.mockRestore(); create.mockRestore(); imported.mockRestore(); insert.mockRestore() }
})
