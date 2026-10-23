import { afterAll, beforeAll, expect, test } from 'bun:test'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'
import { renderToStaticMarkup } from 'react-dom/server'
import { initialManifestEditorState } from '../model/manifestEditor'
import type { ManifestEditorModel } from '../model/useManifestEditor'
import { ManifestStatus } from './ManifestStatus'
import { ManifestToolbar } from './ManifestToolbar'

// The status strip draws its problem through the host's `ProblemLine`; outside the app that is the
// SDK's double. Unbound afterwards, so the shared `bun test mini-apps` process gets its host back.
let unbindDoubles: () => void
beforeAll(() => {
  unbindDoubles = bindMiniAppUiTestDoubles()
})
afterAll(() => unbindDoubles())

function model(overrides: Partial<ManifestEditorModel> = {}): ManifestEditorModel {
  return {
    ...initialManifestEditorState('local/apps/deployment/web'),
    dirty: false,
    canEdit: false,
    canRefresh: false,
    refresh: async () => {},
    startEditing: () => {},
    setDraft: () => {},
    reset: () => {},
    cancelEditing: () => {},
    requestApply: () => {},
    cancelApply: () => {},
    apply: async () => {},
    ...overrides,
  }
}

test('manifest toolbar blocks editing and refresh until the initial YAML is loaded', () => {
  const html = renderToStaticMarkup(<ManifestToolbar model={model()} />)

  expect(html).not.toContain('Link deployment web manifest to chat')
  expect(html).toMatch(/aria-label="Edit manifest"[^>]*disabled/)
  expect(html).toContain('aria-label="Refreshing manifest"')
  expect(html).toMatch(/aria-label="Refreshing manifest"[^>]*disabled/)
})

test('manifest refresh failure keeps one compact stale-content warning', () => {
  const html = renderToStaticMarkup(
    <ManifestStatus
      subject="deployment/api manifest"
      model={model({
        original: 'kind: Deployment',
        loading: false,
        canRefresh: true,
        loadIssue: { message: 'Cluster timed out', detail: 'request exceeded 30s' },
      })}
    />,
  )

  expect(html).toContain('role="alert"')
  // "showing the last valid version" is the SHARED stale label; the title must not say it again.
  expect(html).toContain('The refresh failed.')
  expect(html).not.toContain('Showing the last loaded manifest')
  // The cluster's own words and the operator detail live in the Event Center; the strip is a line.
  expect(html).not.toContain('request exceeded 30s')
  expect(html).toContain('>Details</button>')
  expect(html).toContain('>Retry</button>')
  expect(html).not.toContain('bg-status-warning')
})

test('apply rejection is one line into the report, not a wall of API text', () => {
  const html = renderToStaticMarkup(
    <ManifestStatus
      subject="deployment/api manifest"
      model={model({
        loading: false,
        applyError: 'spec.replicas: Invalid value',
      })}
    />,
  )

  expect(html).toContain('spec.replicas: Invalid value')
  expect(html).toContain('>Details</button>')
  expect(html).not.toContain('<pre')
  expect(html).not.toContain('bg-status-error')
})

test('apply success uses a flat semantic status row', () => {
  const html = renderToStaticMarkup(
    <ManifestStatus
      subject="deployment/api manifest"
      model={model({ loading: false, notice: 'Manifest applied' })}
    />,
  )

  expect(html).toContain('lucide-circle-check')
  expect(html).toContain('Manifest applied')
  expect(html).not.toContain('bg-status-success')
})
