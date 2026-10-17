import { describe, expect, it } from 'bun:test'

import { createPluginBackendHost } from './backend-host'
import { createSubsystemRegistry, type BackendSubsystem } from '../ext/subsystem-contrib'
import { createCapabilityRegistry } from '../ext/capability-registry'
import { createWsFrameRegistry } from '../ext/ws-frame-registry'
import { createResourceProviderRegistry } from '../agent-core/resource-refs/provider'
import { createContextProviderRegistry } from '../context-fabric/registry'

describe('stopping the plugin backend host (server shutdown)', () => {
  it('waits out the boot reconcile in flight and wires, reports and reconciles nothing after', async () => {
    let releaseLoad = () => {}
    const loading = new Promise<void>((resolve) => (releaseLoad = resolve))
    const reconciles: Array<string | undefined> = []
    let loads = 0
    const subsystemRegistry = createSubsystemRegistry()
    const host = createPluginBackendHost({
      subsystemRegistry,
      capabilityRegistry: createCapabilityRegistry(),
      wsFrameRegistry: createWsFrameRegistry(),
      resourceRefsRegistry: createResourceProviderRegistry(),
      contextProviderRegistry: createContextProviderRegistry(),
      loadBackends: async () => {
        loads++
        await loading
        return [{ pluginName: 'late', backend: { id: 'late:backend' } as BackendSubsystem }]
      },
      conditions: {
        backendProblems: () => {},
        reconciled: (error) => reconciles.push(error),
      },
    })

    const boot = host.reconcile()
    let stopped = false
    const stop = host.stop().then(() => (stopped = true))
    await Promise.resolve()
    // `stop` does not resolve while the load is still running: shutdown would close the
    // database and the log under it.
    expect(stopped).toBe(false)
    releaseLoad()
    await Promise.all([boot, stop])

    expect(host.wired()).toEqual([])
    expect(subsystemRegistry.list()).toEqual([])
    expect(reconciles).toEqual([])
    await host.reconcile()
    host.refresh()
    expect(loads).toBe(1)
  })
})
