import { describe, expect, test } from 'bun:test'

import { messageStreamStatusLabel, shouldRenderAssistantSkeleton } from './messageActivity'

describe('assistant activity visibility', () => {
  test('an optimistic streaming row is visible before the first token', () => {
    expect(
      shouldRenderAssistantSkeleton({
        isUser: false,
        isStreaming: true,
        isLast: true,
        isGenerating: true,
        hasVisibleBody: false,
      }),
    ).toBe(true)
  })

  test('a lost stream target still cannot leave the generating tail blank', () => {
    expect(
      shouldRenderAssistantSkeleton({
        isUser: false,
        isStreaming: false,
        isLast: true,
        isGenerating: true,
        hasVisibleBody: false,
      }),
    ).toBe(true)
  })

  test('content replaces the skeleton', () => {
    expect(
      shouldRenderAssistantSkeleton({
        isUser: false,
        isStreaming: true,
        isLast: true,
        isGenerating: true,
        hasVisibleBody: true,
      }),
    ).toBe(false)
  })

  test('the footer follows live phase updates and disappears when the run settles', () => {
    expect(
      messageStreamStatusLabel({
        isStreaming: true,
        phaseLabel: 'Searching files',
        fallbackLabel: 'Working',
      }),
    ).toBe('Searching files')

    expect(
      messageStreamStatusLabel({
        isStreaming: true,
        phaseLabel: 'Running tests',
        fallbackLabel: 'Working',
      }),
    ).toBe('Running tests')

    expect(
      messageStreamStatusLabel({
        isStreaming: false,
        phaseLabel: 'Running tests',
        fallbackLabel: 'Working',
      }),
    ).toBeNull()
  })
})
