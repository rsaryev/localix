import { describe, expect, test } from 'bun:test'
import { resourceMessageBindingDraft, snippetMessageBindingDraft } from '@localixai/mini-app-sdk/ui'
import { mergeReaderPublishedContexts } from './context'

describe('parallel reader context', () => {
  test('prioritizes the active pane, deduplicates resources, and respects the host budget', () => {
    const shared = resourceMessageBindingDraft({
      uri: 'localix://resource/reader/shared',
      label: 'Shared',
    })
    const primary = {
      strategy: 'replace' as const,
      bindings: [
        shared,
        snippetMessageBindingDraft({ label: 'Primary page', content: 'primary', language: 'text' }),
      ],
    }
    const secondary = {
      strategy: 'replace' as const,
      bindings: [
        shared,
        ...Array.from({ length: 6 }, (_, index) =>
          snippetMessageBindingDraft({
            label: `Secondary ${index}`,
            content: `secondary-${index}`,
            language: 'text',
          }),
        ),
      ],
    }

    const merged = mergeReaderPublishedContexts(primary, secondary, 'secondary')

    expect(merged?.bindings).toHaveLength(5)
    expect(merged?.bindings[0]).toEqual(shared)
    expect(merged?.bindings[1]?.target.label).toBe('Secondary 0')
    expect(
      merged?.bindings.filter((binding) => binding.target.token === shared.target.token),
    ).toHaveLength(1)
  })
})
