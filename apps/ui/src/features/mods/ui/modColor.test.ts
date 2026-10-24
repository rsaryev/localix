import { describe, expect, test } from 'bun:test'
import { borderColorOf, fillOf, textColorOf, toneOf } from './modColor'

describe('a colour a mod names becomes one of a few semantic tones', () => {
  test('terminal names and their bright twins', () => {
    expect(toneOf('red')).toBe('danger')
    expect(toneOf('green')).toBe('success')
    expect(toneOf('yellowBright')).toBe('warning')
    expect(toneOf('blue')).toBe('info')
    // No raw cyan or magenta: cyan is the info tone, magenta the accent.
    expect(toneOf('cyan')).toBe('info')
    expect(toneOf('magenta')).toBe('accent')
    expect(toneOf('gray')).toBe('muted')
    expect(toneOf('blackBright')).toBe('muted')
    // White and black are the theme's own text: in a light theme white text would vanish.
    expect(toneOf('white')).toBe('plain')
    expect(toneOf('black')).toBe('plain')
  })

  test('a hex or rgb colour lands on the tone nearest its hue; greys are muted or plain', () => {
    expect(toneOf('#ff3b30')).toBe('danger')
    expect(toneOf('#ff9500')).toBe('warning')
    expect(toneOf('#34c759')).toBe('success')
    expect(toneOf('#00c7be')).toBe('info')
    expect(toneOf('rgb(0, 122, 255)')).toBe('info')
    expect(toneOf('#c040ff')).toBe('accent')
    expect(toneOf('#808080')).toBe('muted')
    expect(toneOf('#f5f5f5')).toBe('plain')
    expect(toneOf('url(evil)')).toBeUndefined()
    expect(toneOf(42)).toBeUndefined()
  })
})

describe('text colour per site', () => {
  test('in a pane a status tone is the status colour the app’s own text uses', () => {
    expect(textColorOf('green', 'pane', false)).toBe('var(--status-success)')
    expect(textColorOf('red', 'pane', false)).toBe('var(--status-error)')
  })

  test('the accent is never the raw violet: it is toned down into the soft text', () => {
    expect(textColorOf('magenta', 'pane', false)).toBe(
      'color-mix(in oklab, var(--conn-violet) 45%, var(--text-soft))',
    )
  })

  test('in the band every tone is toned toward the strip’s soft text', () => {
    expect(textColorOf('magenta', 'band', false)).toBe(
      'color-mix(in oklab, var(--conn-violet) 45%, var(--text-soft))',
    )
    expect(textColorOf('cyan', 'band', false)).toBe(
      'color-mix(in oklab, var(--status-info) 75%, var(--text-soft))',
    )
  })

  test('dim colour fades toward the faint text; grey is the faint text; plain names nothing', () => {
    expect(textColorOf('green', 'pane', true)).toBe(
      'color-mix(in oklab, var(--status-success) 60%, var(--text-faint))',
    )
    expect(textColorOf('gray', 'band', false)).toBe('var(--text-faint)')
    expect(textColorOf('white', 'pane', false)).toBeUndefined()
    expect(textColorOf(undefined, 'pane', false)).toBeUndefined()
  })
})

describe('fills and frames never paint a large saturated area', () => {
  test('a text background is the kit chip’s 12% tint; a box background a neutral veil', () => {
    expect(fillOf('green', 'text')).toBe(
      'color-mix(in oklab, var(--status-success) 12%, transparent)',
    )
    expect(fillOf('magenta', 'box')).toBe('var(--field-fill)')
    expect(fillOf('gray', 'text')).toBe('var(--field-fill)')
    expect(fillOf(undefined, 'box')).toBeUndefined()
  })

  test('a border colour is the border token; only a status tone tints it, faintly', () => {
    expect(borderColorOf('magenta')).toBeUndefined()
    expect(borderColorOf('cyan')).toBeUndefined()
    expect(borderColorOf('red')).toBe(
      'color-mix(in oklab, var(--status-error) 25%, var(--color-border-faint))',
    )
  })
})
