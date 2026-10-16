import { expect, spyOn, test } from 'bun:test'
import { createHumanInLoopController } from '@localixai/agent/agents'
import { createVaultTool } from './agent-tool'

test.each(['create', 'delete'] as const)(
  '%s propagates update failures before requesting human input',
  async (action) => {
    const controller = createHumanInLoopController()
    const request = spyOn(controller, 'request')
    const failure = new Error('Update channel unavailable')
    const remove = async () => ({ status: 'deleted' as const })
    const tool = createVaultTool({
      list: async () => [],
      updateMetadata: async () => ({ status: 'missing' }),
      remove,
    })
    try {
      await expect(
        tool.execute(
          'update-failure',
          action === 'create'
            ? { action, key: 'TEST_KEY', reason: 'Integration' }
            : { action, key: 'TEST_KEY', expected_version: 1, reason: 'Retired' },
          undefined,
          () => {
            throw failure
          },
          { humanInLoop: controller },
        ),
      ).rejects.toBe(failure)
      expect(request).not.toHaveBeenCalled()
    } finally {
      request.mockRestore()
    }
  },
)

test('approved deletion propagates storage failures', async () => {
  const controller = createHumanInLoopController()
  const failure = new Error('Storage unavailable')
  const tool = createVaultTool({
    list: async () => [],
    updateMetadata: async () => ({ status: 'missing' }),
    remove: async () => {
      throw failure
    },
  })
  const execution = tool.execute(
    'storage-failure',
    { action: 'delete', key: 'TEST_KEY', expected_version: 1, reason: 'Retired' },
    undefined,
    undefined,
    { humanInLoop: controller },
  )
  const outcome = execution.catch((error: unknown) => error)
  await Promise.resolve()
  controller.respond({
    requestId: 'storage-failure',
    kind: 'ask',
    payload: {
      answers: [{ id: 'vault_delete', question: 'Delete?', selectedOptions: ['approve'] }],
    },
    respondedAt: Date.now(),
  })
  expect(await outcome).toBe(failure)
})
