import { afterEach, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { loadAgentCommandArgOptions } from './agentCommandArgOptions'

const restores: (() => void)[] = []
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

function fixture() {
  const agents = [
    {
      record: { id: 'a', handle: 'qa', description: 'Checks migrations' },
      enabled: true,
      invocations: { chat: 'allow' },
    },
    {
      record: { id: 'b', handle: 'backend', description: 'Builds APIs' },
      enabled: true,
      invocations: { chat: 'allow' },
    },
    {
      record: { id: 'c', handle: 'offline', description: '' },
      enabled: false,
      invocations: { chat: 'allow' },
    },
    {
      record: { id: 'd', handle: 'worker', description: '' },
      enabled: true,
      invocations: { chat: 'deny' },
    },
  ]
  const snapshot = spyOn(backendClient, 'fetchCapabilitySnapshot').mockResolvedValue({
    agents,
  } as never)
  const session = spyOn(backendClient, 'getSession').mockResolvedValue({
    agents: [
      { agentId: 'a', handle: 'qa' },
      { agentId: 'gone', handle: 'old-reviewer' },
    ],
  } as never)
  restores.push(
    () => snapshot.mockRestore(),
    () => session.mockRestore(),
  )
  return { snapshot, session }
}

test('invitation and removal suggestions use the command’s session and exact project', async () => {
  const h = fixture()
  expect(
    (await loadAgentCommandArgOptions('add', '', 'chat-2', 'project-2')).map((row) => row.value),
  ).toEqual(['@backend'])
  expect(h.snapshot).toHaveBeenCalledWith({ projectId: 'project-2' })
  expect(h.session).toHaveBeenCalledWith('chat-2')
  expect(
    (await loadAgentCommandArgOptions('remove', '', 'chat-2', 'project-2')).map((row) => row.value),
  ).toEqual(['a', 'gone'])
})

test('enable suggestions and searches include only the relevant saved agents', async () => {
  fixture()
  expect(
    (await loadAgentCommandArgOptions('enable', '', null, null)).map((row) => row.value),
  ).toEqual(['@offline'])
  expect(
    (await loadAgentCommandArgOptions('show', 'migrations', null, 'project-2')).map(
      (row) => row.value,
    ),
  ).toEqual(['@qa'])
})
