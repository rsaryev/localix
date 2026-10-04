import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { EffectiveConfigReport } from '@localixai/api/client'
import { DiagnosticsReport } from './DiagnosticsReport'

const source = readFileSync(new URL('./DiagnosticsSettings.tsx', import.meta.url), 'utf8')
const reportSource = readFileSync(new URL('./DiagnosticsReport.tsx', import.meta.url), 'utf8')

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
  plugins: [{ name: 'github', enabled: true }],
}

describe('Diagnostics settings presentation', () => {
  test('uses shared, labelled scope controls instead of local native form geometry', () => {
    expect(source).toContain('aria-label="Effective configuration scope"')
    expect(source).toContain('<Select')
    expect(source).toContain('<Input')
    expect(source).toContain('<Button')
    expect(source).toContain('aria-labelledby={projectLabelId}')
    expect(source).not.toContain('<select')
    expect(source).not.toContain('INPUT_CLS')
  })

  test('uses flat native rows for diagnostics, consumers, permissions, and provenance', () => {
    const html = renderToStaticMarkup(<DiagnosticsReport report={report} />)

    expect(html).toContain('border-y')
    expect(html).toContain('divide-y')
    expect(html).toContain('The selected model is unavailable')
    expect(html).toContain('gpt-5.6')
    expect(html).toContain('bg-status-success')
    expect(html).toContain('>·</span>')
    expect(html).not.toContain('rounded-xl')
    expect(html).not.toContain('bg-background')
    expect(reportSource).not.toContain('<Badge')
    expect(reportSource).not.toContain("from '@/shared/ui/badge'")
  })
})
