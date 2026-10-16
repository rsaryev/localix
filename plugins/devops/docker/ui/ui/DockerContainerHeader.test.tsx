import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DockerContainerTabModel } from '../model/useDockerContainerTab'
import { DockerContainerHeader } from './DockerContainerHeader'

function model(
  state: 'running' | 'exited',
  overrides: Partial<DockerContainerTabModel> = {},
): DockerContainerTabModel {
  return {
    container: {
      id: 'container-1',
      name: 'api',
      image: 'api:latest',
      state,
      status: state === 'running' ? 'Up 5 minutes' : 'Exited (0)',
      ports: '127.0.0.1:8080→80/tcp',
      createdAt: '2026-07-28T00:00:00Z',
    },
    panel: 'logs',
    logsLive: true,
    running: state === 'running',
    busy: false,
    actionError: null,
    refresh: async () => {},
    runAction: async () => {},
    dismissActionError: () => {},
    ...overrides,
  } as DockerContainerTabModel
}

test('shows operational actions only while a container is running', () => {
  const html = renderToStaticMarkup(
    <DockerContainerHeader
      sessionId="chat-a"
      model={model('running')}
      containerId="container-1"
      fallbackName="api"
    />,
  )

  expect(html).toContain('aria-label="Exec into container"')
  expect(html).toContain('aria-label="Stop container"')
  expect(html).toContain('aria-label="Restart container"')
  expect(html).not.toContain('aria-label="Start container"')
  expect(html).not.toContain('Link api to chat')
})

test('offers Start but no Exec for a stopped container', () => {
  const html = renderToStaticMarkup(
    <DockerContainerHeader
      sessionId="chat-a"
      model={model('exited')}
      containerId="container-1"
      fallbackName="api"
    />,
  )

  expect(html).toContain('aria-label="Start container"')
  expect(html).not.toContain('aria-label="Exec into container"')
  expect(html).not.toContain('aria-label="Stop container"')
  expect(html).not.toContain('aria-label="Restart container"')
})
