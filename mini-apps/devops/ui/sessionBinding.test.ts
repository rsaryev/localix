/**
 * Every DevOps open, shell and insert names the chat it acts for.
 *
 * The mini app's tabs used to be global and its terminal spawns passed `sessionId: null`, which the
 * host read as "the chat on screen": a container tab kept for chat A opened its Exec shell in chat
 * B, and a pod clicked in a workspace kept for chat A opened in chat B. The session is now an
 * argument of each door, so these pin that the argument is what reaches the host.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import {
  bindMiniAppUiRuntime,
  type MiniAppUiRuntime,
  type MiniAppWorkItemRequest,
} from '@localixai/mini-app-sdk/ui/runtime'
import { recordingMiniAppUiHost } from '@localixai/mini-app-sdk/ui/testing'
import type { WorkItemKindContribution } from '@localixai/mini-app-sdk/ui'

import { openDockerContainerTab, openDockerResourceTab } from '../docker/ui/model/openTab'
import { execIntoContainer } from '../docker/ui/model/execCommand'
import { spawnInTerminal } from '../docker/ui/model/terminalSpawn'
import { registerDockerContributions } from '../docker/ui/register'
import {
  openKubernetesNodeTabByName,
  openKubernetesPodTab,
  openKubernetesResourceTab,
} from '../kubernetes/ui/model/openTab'
import { registerKubernetesContributions } from '../kubernetes/ui/register'

const opened: MiniAppWorkItemRequest[] = []
const spawned: Array<{ command: string; sessionId: string; title?: string }> = []
let unbind: (() => void) | undefined

function bind() {
  unbind = bindMiniAppUiRuntime({
    workspace: { openWorkItem: (request: MiniAppWorkItemRequest) => opened.push(request) },
    terminal: {
      spawnCommand: async (request: { command: string; sessionId: string; title?: string }) => {
        spawned.push(request)
        return { terminalId: 't-1' }
      },
    },
  } as unknown as MiniAppUiRuntime)
}

afterEach(() => {
  unbind?.()
  unbind = undefined
  opened.length = 0
  spawned.length = 0
})

describe('DevOps tabs open in the chat that asked', () => {
  test('container, pod, workload and node tabs carry the session; a Docker resource is app-level', () => {
    bind()
    openDockerContainerTab('chat-a', 'c1', 'api')
    openKubernetesPodTab('chat-a', 'web-0', 'default', 'kind')
    openKubernetesResourceTab('chat-a', 'deployment', 'web', 'default', 'kind')
    openKubernetesNodeTabByName('chat-a', 'node-1', 'kind')
    openDockerResourceTab({
      kind: 'volume',
      resource: { name: 'data', driver: 'local', scope: 'local' } as never,
    })

    expect(opened.map((request) => [request.workKind, request.scope])).toEqual([
      ['devops:docker-container', 'chat-a'],
      ['devops:kubernetes-pod', 'chat-a'],
      ['devops:kubernetes-resource', 'chat-a'],
      ['devops:kubernetes-resource', 'chat-a'],
      ['devops:docker-resource', null],
    ])
  })

  test('a shell opens in the named chat’s terminal, never an unbound one', async () => {
    bind()
    await spawnInTerminal('chat-a', 'docker compose up -d', 'compose up')
    await execIntoContainer('chat-b', 'c1', 'api')

    expect(spawned.map((request) => request.sessionId)).toEqual(['chat-a', 'chat-b'])
  })

  test('only the Docker resource kind is registered app-level', () => {
    const { host, registrations } = recordingMiniAppUiHost()
    registerDockerContributions(host)
    registerKubernetesContributions(host)

    const scopes = Object.fromEntries(
      (registrations.workItems as WorkItemKindContribution[]).map((kind) => [
        kind.kind,
        kind.scope ?? 'session',
      ]),
    )
    expect(scopes).toEqual({
      'devops:docker-container': 'session',
      'devops:docker-resource': 'global',
      'devops:kubernetes-pod': 'session',
      'devops:kubernetes-resource': 'session',
    })
  })
})
