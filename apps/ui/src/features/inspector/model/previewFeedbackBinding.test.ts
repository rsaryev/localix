import { describe, expect, test } from 'bun:test'
import { previewFeedbackBinding } from './previewFeedbackBinding'
import { refFromContextBinding } from '@/entities/chat/model/sendRefs'

const input = {
  id: 'first',
  capture: {
    selector: '#save',
    summary: 'Save button',
    domPath: 'form > button',
    classes: '',
    kind: 'element' as const,
    rect: { x: 10, y: 20, width: 80, height: 32 },
  },
  note: 'Increase spacing',
  url: 'http://localhost:5173/?token=private',
  viewport: { width: 390, height: 844 },
}

describe('preview feedback context', () => {
  test('keeps evidence in the canonical context binding, with a sanitized URL', () => {
    const binding = previewFeedbackBinding({
      ...input,
      assets: [{ kind: 'image', mediaType: 'image/jpeg', data: 'YWJj', name: 'shot.jpg', size: 3 }],
    })
    const ref = refFromContextBinding(binding)
    expect(ref.content).toContain('Increase spacing')
    expect(ref.content).toContain('390×844')
    expect(ref.content).toContain('#save')
    expect(ref.content).not.toContain('token=private')
    expect(binding.target.kind).toBe('snippet')
    expect(ref.messageBinding?.assets?.[0]?.kind).toBe('image')
  })

  test('independent observations of the same element have independent context keys', () => {
    const first = refFromContextBinding(previewFeedbackBinding(input))
    const second = refFromContextBinding(previewFeedbackBinding({ ...input, id: 'second' }))
    expect(first.key).not.toBe(second.key)
  })
})
