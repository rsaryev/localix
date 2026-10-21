import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { __resetCapabilityCache, ensureCapabilities, peekCapabilities } from './capabilityCache'
import { __resetPluginContrib, preparePluginContribScope } from './enabledPlugins'

// Before as well as after: a suite that ran earlier in the same process can leave the workbench's
// capability document behind, and a document for `''` makes the cache rightly skip that scope.
const reset = () => {
  __resetCapabilityCache()
  __resetPluginContrib()
}
beforeEach(reset)
afterEach(reset)

test('the scope the workbench is loading is not fetched a second time by the cache', async () => {
  const fetchSnapshot = spyOn(backendClient, 'fetchCapabilitySnapshot').mockResolvedValue({
    revision: 1,
    scope: { projectId: '', agentId: null },
  } as CapabilitySnapshot)
  try {
    preparePluginContribScope('PRJ-1')
    ensureCapabilities('PRJ-1')
    expect(fetchSnapshot).not.toHaveBeenCalled()
    expect(peekCapabilities('PRJ-1').loading).toBe(true)

    // Any other scope is still the cache's to read.
    ensureCapabilities('')
    expect(fetchSnapshot).toHaveBeenCalledTimes(1)
    expect(fetchSnapshot.mock.calls[0]?.[0]).toEqual({ projectId: null, agentId: null })
  } finally {
    fetchSnapshot.mockRestore()
  }
})
