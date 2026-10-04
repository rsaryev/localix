import { expect, test } from 'bun:test'
import { defineAgentTool } from '@localixai/agent/agents'
import type { PluginContext } from '@localixai/plugin-sdk/backend'
import path from 'node:path'
import { z } from 'zod'

import { createApiTool } from './api-tool'
import { createHttpRequestTool, type HttpRequestDeps } from './http-request'
import { createManageEnvironmentTool } from './manage-environment'

test('API tools declare the paths their execute branches can write', () => {
  const repoRoot = path.resolve(import.meta.dir, '../../..')
  const cwd = path.join(repoRoot, '.permission-path-test-workspace')
  const stateDir = path.resolve(repoRoot, '..', '.permission-path-test-state', 'api')
  const collectionRoot = path.join(cwd, '.localix', 'api')
  const activePointer = path.join(stateDir, 'active-environment.json')
  const ctx = {
    cwd,
    stateDir,
    z,
    defineTool: defineAgentTool,
    config: {},
    helpers: {
      configNumber: (_value: unknown, fallback: number) => fallback,
      configBoolean: (_value: unknown, fallback: boolean) => fallback,
    },
    ui: { offer: () => ({}) },
  } as unknown as PluginContext
  const deps = {
    ctx,
    store: { root: () => collectionRoot },
    environments: {},
    resolveSecret: async () => null,
    userId: 'permission-path-test',
  } as unknown as HttpRequestDeps
  const requests = createHttpRequestTool(deps)
  const environments = createManageEnvironmentTool({
    ctx,
    environments: deps.environments,
    userId: deps.userId,
  })
  const api = createApiTool(deps)

  const requestFile = path.join(collectionRoot, 'users', 'list.request.json')
  expect(requests.permissionPaths?.({ action: 'save', name: 'users/list' })).toEqual([
    requestFile,
    collectionRoot,
  ])
  expect(requests.permissionPaths?.({ action: 'delete', name: 'users/list' })).toEqual([
    requestFile,
    collectionRoot,
  ])
  expect(requests.permissionPaths?.({ action: 'export', dir: 'review/api' })).toEqual([
    path.join(cwd, 'review', 'api'),
  ])
  expect(requests.permissionPaths?.({ action: 'export', dir: '../escape' })).toEqual([])
  expect(requests.permissionPaths?.({ action: 'import', save: true })).toEqual([
    collectionRoot,
    activePointer,
  ])
  expect(requests.permissionPaths?.({ action: 'send', method: 'DELETE' })).toEqual([])

  const environmentRoot = path.join(collectionRoot, 'environments')
  const environmentFile = path.join(environmentRoot, 'staging.json')
  expect(environments.permissionPaths?.({ action: 'save', name: 'staging' })).toEqual([
    environmentFile,
    environmentRoot,
    activePointer,
  ])
  expect(environments.permissionPaths?.({ action: 'use', name: 'staging' })).toEqual([
    activePointer,
  ])
  expect(environments.permissionPaths?.({ action: 'delete', name: 'staging' })).toEqual([
    environmentFile,
    activePointer,
  ])
  expect(path.relative(cwd, activePointer).startsWith('..')).toBe(true)

  expect(api.permissionPaths?.({ action: 'save', name: 'users/list' })).toEqual([
    requestFile,
    collectionRoot,
  ])
  expect(
    api.permissionPaths?.({
      action: 'use',
      target: 'environment',
      name: 'staging',
    }),
  ).toEqual([activePointer])
  expect(
    api.permissionPaths?.({
      action: 'batch',
      operations: [
        { action: 'save', name: 'users/list' },
        { action: 'use', target: 'environment', name: 'staging' },
        { action: 'save', name: 'users/list' },
      ],
    }),
  ).toEqual([requestFile, collectionRoot, activePointer])

  const scopedApi = createApiTool({
    ...deps,
    resolveScope: async () => ({
      store: deps.store,
      environments: deps.environments,
    }),
  })
  const sessionCollections = path.join('.localix', 'api')
  expect(scopedApi.permissionPaths?.({ action: 'save', name: 'users/list' })).toEqual([
    sessionCollections,
  ])
  expect(
    scopedApi.permissionPaths?.({
      action: 'use',
      target: 'environment',
      name: 'staging',
    }),
  ).toEqual([sessionCollections])
  expect(scopedApi.permissionPaths?.({ action: 'import', save: false })).toEqual([])
  expect(scopedApi.permissionPaths?.({ action: 'send', method: 'DELETE' })).toEqual([])
  expect(
    scopedApi.permissionPaths?.({
      action: 'batch',
      operations: [
        { action: 'save', name: 'users/list' },
        { action: 'use', target: 'environment', name: 'staging' },
      ],
    }),
  ).toEqual([sessionCollections])
  expect(scopedApi.permissionPaths?.({ action: 'export', dir: 'review/api' })).toEqual([
    path.join(cwd, 'review', 'api'),
  ])
})
