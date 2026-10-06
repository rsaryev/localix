import { describe, expect, test } from 'bun:test'
import { detectInstalledExternalAgents, installedAgentsPrompt } from './installed'

describe('installed external CLIs', () => {
  test('does not infer installation from recorded history', () => {
    expect(detectInstalledExternalAgents(() => undefined)).toEqual([])
    expect(installedAgentsPrompt([])).toBe('')
  })
  test('returns only executable commands and a compact launch prompt', () => {
    const agents = detectInstalledExternalAgents((command) =>
      command === 'codex' ? '/bin/codex' : undefined,
    )
    expect(agents).toEqual([{ id: 'codex', name: 'Codex', command: 'codex' }])
    expect(installedAgentsPrompt(agents)).toContain('- Codex: `codex`')
    expect(installedAgentsPrompt(agents)).not.toContain('Claude')
    expect(installedAgentsPrompt(agents)).not.toContain('resume')
  })
  test('recognizes supported aliases without duplicate agents', () => {
    const agents = detectInstalledExternalAgents((command) =>
      command === 'hermes-agent' ? '/bin/hermes-agent' : undefined,
    )
    expect(agents).toHaveLength(1)
    expect(agents[0]).toMatchObject({ id: 'hermes', command: 'hermes-agent' })
  })
})
