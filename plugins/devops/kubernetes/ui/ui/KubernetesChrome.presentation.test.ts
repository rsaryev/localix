import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const pulseSource = readFileSync(new URL('./KubernetesPulse.tsx', import.meta.url), 'utf8')
const controlsSource = readFileSync(new URL('./SidebarControls.tsx', import.meta.url), 'utf8')
const nodeHeaderSource = readFileSync(
  new URL('./KubernetesNodeHeader.tsx', import.meta.url),
  'utf8',
)

describe('Kubernetes panel chrome', () => {
  test('keeps persistent summary and scope rows transparent', () => {
    expect(pulseSource).not.toContain('bg-surface-raised')
    expect(controlsSource).not.toContain('bg-surface-raised')
    expect(pulseSource).toContain('border-b border-border-soft')
    expect(controlsSource).toContain('<WorkbenchFilterBar')
  })

  test('keeps the node glyph subordinate to the resource identity', () => {
    expect(nodeHeaderSource).toContain("'flex size-5 shrink-0 items-center justify-center'")
    expect(nodeHeaderSource).not.toContain('rounded-lg border')
    expect(nodeHeaderSource).not.toContain('bg-surface-raised')
  })
})
