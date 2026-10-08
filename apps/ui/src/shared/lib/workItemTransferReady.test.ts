import { afterEach, expect, test } from 'bun:test'
import { waitForTransferResources, workItemTransferReady } from './workItemTransferReady'

const keys = ['terminal:readiness-test', 'browser:readiness-test']
afterEach(() => workItemTransferReady.release(keys))

test('all resources must accept before the destination can acknowledge', async () => {
  workItemTransferReady.arm(keys)
  let accepted = false
  const waiting = waitForTransferResources(keys, 1000).then(() => {
    accepted = true
  })
  workItemTransferReady.success(keys[0]!)
  await Promise.resolve()
  expect(accepted).toBe(false)
  workItemTransferReady.success(keys[1]!)
  await waiting
  expect(accepted).toBe(true)
})

test('an opening failure stays failed even if a late success arrives', async () => {
  workItemTransferReady.arm(keys)
  workItemTransferReady.failure(keys[0]!, 'page refused')
  workItemTransferReady.success(keys[0]!)
  await expect(waitForTransferResources(keys, 1000)).rejects.toThrow('page refused')
})

test('a missing attachment times out instead of authorizing source removal', async () => {
  workItemTransferReady.arm(keys)
  await expect(waitForTransferResources(keys, 5)).rejects.toThrow('could not attach')
})
