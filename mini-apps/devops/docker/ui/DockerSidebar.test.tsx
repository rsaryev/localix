import { afterEach, beforeEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'

// Bound here, not only in the mini app preload: the combined `bun test mini-apps` run loads no
// preload, and another suite's doubles would decide what the problem surface renders.
let unbind = () => {}
beforeEach(() => {
  unbind = bindMiniAppUiTestDoubles()
})
afterEach(() => unbind())
import type { DockerWorkbenchModel } from './model/useDocker'
import { DockerSidebarView } from './DockerSidebar'

function model(state: Partial<DockerWorkbenchModel> = {}): DockerWorkbenchModel {
  return {
    containers: [],
    images: [],
    volumes: [],
    networks: [],
    loading: true,
    refreshing: false,
    unavailable: false,
    composeAvailable: false,
    resourceErrors: {},
    error: null,
    refresh: async () => {},
    ...state,
  } as DockerWorkbenchModel
}

test('composes the standalone Docker header with its loading inventory', () => {
  const html = renderToStaticMarkup(<DockerSidebarView docker={model()} />)
  expect(html).toContain('Docker')
  expect(html).toContain('aria-label="Refresh"')
  expect(html).toContain('Loading containers')
})

test('composes embedded healthy inventory controls without a duplicate panel header', () => {
  const html = renderToStaticMarkup(
    <DockerSidebarView embedded docker={model({ loading: false })} />,
  )

  expect(html.match(/aria-label="Refresh"/g)).toHaveLength(1)
  expect(html).toContain('aria-label="Container resource kinds"')
  expect(html.match(/role="tab"/g)).toHaveLength(4)
  expect(html).toContain('aria-label="Prune containers"')
  expect(html).toContain('No containers.')
})

const engine = (state: 'missing' | 'stopped') => ({
  code: 'engine_unavailable',
  message: 'Docker is not available — is Docker installed and the daemon running?',
  prerequisite: {
    id: 'docker',
    name: 'Docker',
    state,
    installUrl: 'https://docs.docker.com/get-started/get-docker/',
    command: 'open -a Docker',
  },
})

test('a stopped engine is a centred pane that offers to start it, without prune', () => {
  const html = renderToStaticMarkup(
    <DockerSidebarView
      docker={model({ loading: false, unavailable: true, error: engine('stopped') })}
    />,
  )

  expect(html).toContain('data-problem-shape="state"')
  expect(html).toContain('Docker is not running')
  expect(html).toContain('Copy start command')
  expect(html).not.toContain('aria-label="Prune containers"')
  expect(html).toContain('aria-label="Refresh"')
})

test('a missing engine offers the install page instead of a Retry that cannot help first', () => {
  const html = renderToStaticMarkup(
    <DockerSidebarView
      docker={model({ loading: false, unavailable: true, error: engine('missing') })}
    />,
  )

  expect(html).toContain('Docker is not installed')
  expect(html.indexOf('Install Docker')).toBeLessThan(html.indexOf('>Retry<'))
})

test('keeps inventory visible and disables duplicate refresh while reconciliation is active', () => {
  const html = renderToStaticMarkup(
    <DockerSidebarView embedded docker={model({ loading: false, refreshing: true })} />,
  )

  expect(html).toContain('No containers.')
  expect(html).toMatch(/aria-label="Refresh"[^>]*disabled/)
  expect(html).toContain('data-state="working"')
})
