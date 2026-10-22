import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  createWsFrameConnection,
  type HostRouteContext,
  type PluginContext,
} from '@localixai/plugin-sdk/backend'
import { createPluginBackendHost } from '../apps/api/src/features/plugins/backend-host'
import { createSubsystemRegistry } from '../apps/api/src/features/ext/subsystem-contrib'
import { createCapabilityRegistry } from '../apps/api/src/features/ext/capability-registry'
import { createWsFrameRegistry } from '../apps/api/src/features/ext/ws-frame-registry'
import { createResourceProviderRegistry } from '../apps/api/src/features/agent-core/resource-refs/provider'
import { createContextProviderRegistry } from '../apps/api/src/features/context-fabric/registry'
import { register } from '../plugins/project-space/backend'
import { ROUTE_PATH, SPACE_SUBSCRIBE } from '../plugins/project-space/shared/resource'
import manifest from '../plugins/project-space/.claude-plugin/plugin.json'
import type { SpaceView } from '../plugins/project-space/shared/api'
import { spaceStore } from '../plugins/project-space/backend/space-store'

// Direct route tests cannot detect the host rejecting a whole backend for an invalid WS name.
// Exercise the real composition seam: the HTTP board and its advertised stream must both wire.
test('the scoped Project Space backend serves HTTP and live changes through the plugin host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'space-host-'))
  const wsFrameRegistry = createWsFrameRegistry()
  const boardUrl = `${ROUTE_PATH}/space?sessionId=s`
  let enabled = true
  const ctx = {
    userId: 'owner',
    cwd: root,
    z,
    defineTool: (definition: unknown) => definition,
    host: {
      workspaceScope: {
        resolveSessionRoot: async () => root,
        resolveProjectRoot: async () => root,
      },
    },
  } as unknown as PluginContext
  const host = createPluginBackendHost({
    subsystemRegistry: createSubsystemRegistry(),
    capabilityRegistry: createCapabilityRegistry(),
    wsFrameRegistry,
    resourceRefsRegistry: createResourceProviderRegistry(),
    contextProviderRegistry: createContextProviderRegistry(),
    loadBackends: async () => {
      if (!enabled) return []
      const contribution = register(ctx).backend
      const backends = Array.isArray(contribution)
        ? contribution
        : contribution
          ? [contribution]
          : []
      return backends.map((backend) => ({ pluginName: manifest.name, backend }))
    },
    resolveScope: ({ userId }) => ({ userId, sessionId: 's', projectId: 'p', cwd: root }),
  })
  const app = new Hono<HostRouteContext>()
  app.use('*', async (c, next) => {
    c.set('userId', 'owner')
    await next()
  })
  app.use('*', host.middleware())
  const frames: Array<{ sessionId: string; revision: string }> = []
  const connection = createWsFrameConnection(
    wsFrameRegistry,
    (frame) => frames.push(JSON.parse(frame.slice(2))),
    { userId: 'owner' },
  )
  try {
    await host.reconcile()
    expect(host.wired()).toEqual([manifest.name])
    const first = await app.request(boardUrl)
    expect(first.status).toBe(200)
    expect((await first.json()).liveUpdates).toBe(true)
    expect(wsFrameRegistry.findBySubscribe(SPACE_SUBSCRIBE)).toBeDefined()
    expect(connection.subscribe(SPACE_SUBSCRIBE, { sessionId: 's' })).toBe(true)
    await Promise.resolve()
    const response = await app.request(`${ROUTE_PATH}/ops?sessionId=s`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ op: 'create', type: 'note', id: 'added' }] }),
    })
    expect(response.status).toBe(200)
    const saved = (await response.json()) as SpaceView
    expect(saved.space.elements.added).toBeDefined()
    expect(saved.liveUpdates).toBe(true)
    expect(frames).toEqual([{ sessionId: 's', revision: saved.revision }])
    enabled = false
    await host.reconcile()
    expect((await app.request(boardUrl)).status).toBe(404)
    expect(wsFrameRegistry.findBySubscribe(SPACE_SUBSCRIBE)).toBeUndefined()
    await spaceStore.apply(root, [{ op: 'delete', id: 'added' }], 'agent')
    expect(frames, 'hot disable must stop existing listeners too').toHaveLength(1)
    enabled = true
    await host.reconcile()
    expect(connection.subscribe(SPACE_SUBSCRIBE, { sessionId: 's' })).toBe(true)
    await Promise.resolve()
    const recreated = await spaceStore.apply(
      root,
      [{ op: 'create', type: 'note', id: 'added' }],
      'user',
    )
    expect(frames.at(-1)?.revision).toBe(recreated.snapshot.revision)
    expect(frames).toHaveLength(2)
  } finally {
    connection.teardown()
    enabled = false
    await host.reconcile()
    rmSync(root, { recursive: true, force: true })
  }
})
