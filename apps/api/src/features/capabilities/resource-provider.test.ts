import { describe, expect, test } from 'bun:test'
import {
  capabilityResourceUri,
  type CapabilityResourceKind,
} from '@localixai/plugin-sdk/navigation'
import { createCapabilityResourceProvider } from './resource-provider'

describe('capability resource provider', () => {
  test('expands a scoped tool link into compact agent guidance', async () => {
    const provider = createCapabilityResourceProvider()
    const result = await provider.expand(
      'user-1',
      capabilityResourceUri({
        kind: 'tool',
        id: 'bash',
        scope: 'PRJ-7',
        label: 'Shell',
        description: 'Run commands in the workspace.',
        enabled: true,
      }),
    )

    expect(result).toEqual({
      ok: true,
      content: [
        'Capability: Shell',
        'Kind: tool',
        'Identifier: bash',
        'Scope: project PRJ-7',
        'Availability when linked: enabled',
        'Description: Run commands in the workspace.',
        'Settings URI: localix://ui/settings/tools/tool-bash?scope=PRJ-7',
        'Link semantics: User-selected context only; linking does not enable or invoke this capability.',
        'Guidance: Use this capability only if it is available and relevant. If its settings may help, link them with their exact `localix://` URI in your reply — the workbench renders it as a button.',
      ].join('\n'),
    })
  })

  test.each<CapabilityResourceKind>(['plugin', 'skill', 'tool', 'agent', 'mcp', 'view'])(
    'keeps a linked %s descriptive and non-invoking',
    async (kind) => {
      const provider = createCapabilityResourceProvider()
      const result = await provider.expand(
        'user-1',
        capabilityResourceUri({
          kind,
          id: `${kind}-id`,
          scope: '',
          label: `${kind} label`,
          enabled: false,
        }),
      )

      expect(result.ok).toBe(true)
      expect(result.content).toContain(`Kind: ${kind}`)
      expect(result.content).toContain('Availability when linked: disabled')
      expect(result.content).toContain('Settings URI: localix://ui/settings/')
      expect(result.content).toContain('exact `localix://` URI in your reply')
      expect(result.content).toContain(
        'Link semantics: User-selected context only; linking does not enable or invoke this capability.',
      )
    },
  )

  test('rejects malformed and unknown capability references', async () => {
    const provider = createCapabilityResourceProvider()
    expect(await provider.expand('user-1', 'localix://resource/capability/unknown/nope')).toEqual({
      ok: false,
      error: 'invalid capability reference',
    })
  })
})
