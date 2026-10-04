import { describe, expect, test } from 'bun:test'
import { choiceTriggerIconVariants, choiceTriggerVariants } from './choice-trigger'

describe('choice trigger foundation', () => {
  test('maps every density to the shared physical control scale', () => {
    // Each size name IS its rung — the same name means the same pixels as on a Button.
    expect(choiceTriggerVariants({ size: 'md' })).toContain('h-[var(--chrome-control-md)]')
    expect(choiceTriggerVariants({ size: 'lg' })).toContain('h-[var(--chrome-control-lg)]')
    expect(choiceTriggerVariants({ size: 'xl' })).toContain('h-[var(--chrome-control-xl)]')
    expect(choiceTriggerVariants({ size: 'xl' })).toContain('text-sm')
  })

  test('keeps focus, invalid, disabled and placeholder states in one recipe', () => {
    const value = choiceTriggerVariants({ placeholder: false })
    const placeholder = choiceTriggerVariants({ placeholder: true })

    expect(value).toContain('focus-visible:ring-control-border-focus')
    expect(value).toContain('aria-invalid:border-destructive')
    expect(value).toContain('disabled:cursor-not-allowed')
    expect(value).toContain('text-foreground')
    expect(placeholder).toContain('text-text-faint')
  })

  test('scales the disclosure glyph with its trigger', () => {
    expect(choiceTriggerIconVariants({ size: 'md' })).toContain('size-3')
    expect(choiceTriggerIconVariants({ size: 'lg' })).toContain('size-3.5')
    expect(choiceTriggerIconVariants({ size: 'xl' })).toContain('size-4')
  })
})
