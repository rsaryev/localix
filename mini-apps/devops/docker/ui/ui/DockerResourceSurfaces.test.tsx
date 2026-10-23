import { afterAll, beforeAll, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'
import type { DockerResourceDetail } from '../model/dockerResourceDetail'
import type { DockerResourceDetailModel } from '../model/useDockerResourceDetail'
import { DockerResourceContent } from './DockerResourceContent'
import { DockerResourceHeader } from './DockerResourceHeader'

const detail: DockerResourceDetail = {
  kind: 'image',
  resource: {
    id: 'sha256:abc',
    repository: 'local/api',
    tag: 'latest',
    size: '10MB',
    createdAt: 'now',
  },
}

function model(overrides: Partial<DockerResourceDetailModel> = {}): DockerResourceDetailModel {
  return {
    detail,
    loading: false,
    error: null,
    label: 'local/api:latest',
    fields: [
      { label: 'Repository', value: 'local/api' },
      { label: 'Image ID', value: 'sha256:abc' },
    ],
    refresh: async () => {},
    ...overrides,
  }
}

// The content renders the host's `ProblemLine`. The mini app's own preload binds the SDK's
// stand-ins, but a run of this file from the repository root loads only the root preload, and the
// first render threw "Mini app UI components are not bound by the host". The suite binds them
// itself and restores whatever it shadowed, so its doubles never become the next suite's host.
let unbindHostComponents: (() => void) | undefined
beforeAll(() => {
  unbindHostComponents = bindMiniAppUiTestDoubles()
})
afterAll(() => unbindHostComponents?.())

test('Docker resource header keeps refresh without redundant context actions', () => {
  const html = renderToStaticMarkup(<DockerResourceHeader kind="image" model={model()} />)

  expect(html).not.toContain('Link local/api:latest to chat')
  expect(html).toContain('aria-label="Refresh resource"')
  expect(html).not.toContain('Copy resource reference')
  expect(html).not.toContain('bg-surface-raised')
  expect(html).not.toContain('rounded-lg border')
})

test('a refresh failure keeps the last good Docker resource fields visible', () => {
  const html = renderToStaticMarkup(
    <DockerResourceContent model={model({ error: { message: 'Docker request timed out' } })} />,
  )

  // One problem: the daemon's sentence IS the headline, with the way into the record beside it.
  expect(html).toContain('Docker request timed out')
  expect(html).toContain('Details')
  expect(html).toContain('local/api')
  expect(html).toContain('sha256:abc')
  expect(html).toContain('border-y')
  expect(html).not.toContain('rounded-xl')
  expect(html).not.toContain('bg-surface-raised/40')
})
