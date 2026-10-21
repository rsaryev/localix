import { expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { waitForRuntimeCapabilities } from '@/shared/contrib/runtimeCapabilityReadiness'
import { persistPinnedSkills } from './pinnedSkillMutations'

test('an immediate run waits for the latest pinned-skill snapshot', async () => {
  let release!: () => void
  const updated = { id: 'session-1', pinnedSkills: ['review'] } as never
  const save = spyOn(backendClient, 'setSessionSkills').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve(updated)
      }),
  )

  const mutation = persistPinnedSkills('session-1', ['review'], 'project-1')
  expect(save).toHaveBeenCalledWith('session-1', ['review'])

  const runBarrier = waitForRuntimeCapabilities('project-1')
  expect(runBarrier).not.toBeNull()
  let ready = false
  void runBarrier!.then(() => {
    ready = true
  })
  await Promise.resolve()
  expect(ready).toBe(false)

  release()
  expect(await mutation).toBe(updated)
  await runBarrier
  expect(ready).toBe(true)
  save.mockRestore()
})
