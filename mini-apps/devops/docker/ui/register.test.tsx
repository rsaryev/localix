import { expect, test } from 'bun:test'

import type {
  MiniAppUiHost,
  UiAnchorContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'
import { registerDockerContributions } from './register'

test('live Docker tabs stay transient and expose native agent context bindings', () => {
  const workItems: WorkItemKindContribution[] = []
  const anchors: UiAnchorContribution[] = []
  const fileIconNames: string[] = []
  const noop = { register: () => {} }
  const host = {
    workItems: { register: (item: WorkItemKindContribution) => workItems.push(item) },
    railSections: noop,
    railViewlets: noop,
    search: noop,
    anchors: {
      register: (anchor: UiAnchorContribution) => {
        anchors.push(anchor)
        return true
      },
    },
    resourceRefIcons: noop,
    fileIcons: { register: (name: string) => fileIconNames.push(name) },
    fileEditors: noop,
    fileFormats: noop,
    sessionEvents: noop,
  } as unknown as MiniAppUiHost

  registerDockerContributions(host)

  expect(fileIconNames).toEqual(['dockerfile'])

  const container = workItems.find((item) => item.kind === 'devops:docker-container')
  expect(container?.restorable).toBe(false)
  // A session kind: its Exec shells into the terminal of the chat it belongs to.
  expect(container?.scope).toBeUndefined()
  expect(
    container?.toMessageBinding?.(
      {
        kind: 'devops:docker-container',
        id: 'devops:docker-container:abc',
        title: 'api',
        payload: { containerId: 'abc', name: 'api' },
      },
      { session: null },
    ),
  ).toMatchObject({ target: { uri: 'localix://resource/docker/abc', label: 'api' } })

  const resource = workItems.find((item) => item.kind === 'devops:docker-resource')
  expect(resource?.restorable).toBe(false)
  expect(
    resource?.toMessageBinding?.(
      {
        kind: 'devops:docker-resource',
        id: 'devops:docker-resource:image',
        title: 'api:latest',
        payload: {
          resourceKind: 'image',
          resourceIdentity: 'sha256:abc',
          uri: 'localix://resource/docker/image/sha256%3Aabc',
        },
      },
      { session: null },
    ),
  ).toMatchObject({
    target: { uri: 'localix://resource/docker/image/sha256%3Aabc', label: 'api:latest' },
  })

  expect(anchors[0]?.resolve('localix://resource/docker/image/sha256%3Aabc')).toMatchObject({
    kind: 'work-item',
    workKind: 'devops:docker-resource',
    id: 'devops:docker-resource:localix://resource/docker/image/sha256%3Aabc',
    title: 'sha256:abc',
    payload: {
      resourceKind: 'image',
      resourceIdentity: 'sha256:abc',
      uri: 'localix://resource/docker/image/sha256%3Aabc',
    },
  })

  expect(anchors[0]?.resolve('localix://resource/docker/images')).toMatchObject({
    kind: 'work-item',
    workKind: 'devops:workspace',
    id: 'devops:workspace',
    payload: { area: 'containers', dockerResource: 'images' },
  })
})
