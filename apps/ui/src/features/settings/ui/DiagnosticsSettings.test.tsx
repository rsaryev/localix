import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { EffectiveConfigReport } from '@localixai/api/client'
import { DiagnosticsReport } from './DiagnosticsReport'

const report: EffectiveConfigReport = {
  schemaVersion: 1,
  revision: 'rev-1',
  scope: { userId: 'user-1', projectId: null, sessionId: null },
  values: { defaultModelId: 'anthropic/sonnet' },
  provenance: { defaultModelId: { scope: 'user' } },
  reload: { defaultModelId: 'next-run' },
  diagnostics: [
    {
      code: 'model.unavailable',
      severity: 'warning',
      message: 'The selected model is unavailable',
      field: 'model',
    },
  ],
  consumers: [
    {
      id: 'session',
      label: 'Session',
      slotConfigured: true,
      providerConnectionId: 'openai',
      modelId: 'gpt-5.6',
      usable: true,
      source: 'session',
    },
  ],
  tools: {
    enabled: ['read_file'],
    // `source` is machine-readable attribution beside the prose reason, so a surface can
    // act on WHY a tool is denied (a mode gate is temporary; a missing capability is not)
    // without parsing the sentence.
    disabled: [
      {
        name: 'write_file',
        reason: 'disabled by settings (disabledTools)',
        source: 'settings' as const,
      },
    ],
  },
  permissions: [
    {
      permission: 'shell',
      pattern: 'git status',
      action: 'allow',
      scope: 'user',
    },
  ],
  skills: [{ name: 'interface-design', override: 'enabled' }],
  miniApps: [{ name: 'github', enabled: true }],
}

describe('Diagnostics settings presentation', () => {
  test('renders diagnostics and consumers from the effective configuration report', () => {
    const html = renderToStaticMarkup(<DiagnosticsReport report={report} />)

    expect(html).toContain('The selected model is unavailable')
    expect(html).toContain('gpt-5.6')
  })
})
