import { describe, expect, it } from 'bun:test'
import { classifyTerminalKey, type TerminalKeyEvent } from './terminalKeymap'
import { OS_FAMILY } from '@localixai/kit/environment'

const ev = (partial: Partial<TerminalKeyEvent>): TerminalKeyEvent => ({
  key: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...partial,
})

describe('classifyTerminalKey', () => {
  const mod = OS_FAMILY === 'mac' ? { metaKey: true } : { ctrlKey: true }
  const foreignMod = OS_FAMILY === 'mac' ? { ctrlKey: true } : { metaKey: true }

  it('claims the OS-primary K chord for clear without stealing the foreign modifier', () => {
    expect(classifyTerminalKey(ev({ key: 'k', ...mod }))).toBe('clear')
    expect(classifyTerminalKey(ev({ key: 'K', ...mod }))).toBe('clear')
    expect(classifyTerminalKey(ev({ key: 'k', ...foreignMod }))).toBe('passthrough')
  })

  it('does NOT claim ⌘⇧K / ⌘⌥K (leave chorded/alt variants to the workspace)', () => {
    expect(classifyTerminalKey(ev({ key: 'k', ...mod, shiftKey: true }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 'k', ...mod, altKey: true }))).toBe('passthrough')
  })

  it('claims ⌘F / Ctrl+F for find', () => {
    expect(classifyTerminalKey(ev({ key: 'f', ...mod }))).toBe('find')
    expect(classifyTerminalKey(ev({ key: 'F', ...mod }))).toBe('find')
  })

  it('claims ⌘⇧O for the link quickpick (and swallows it so the global go-to-symbol never double-fires)', () => {
    expect(classifyTerminalKey(ev({ key: 'o', ...mod, shiftKey: true }))).toBe('open-links')
    expect(classifyTerminalKey(ev({ key: 'O', ...mod, shiftKey: true }))).toBe('open-links')
    // Without shift it is NOT the link picker (⌘O is unclaimed).
    expect(classifyTerminalKey(ev({ key: 'o', ...mod }))).toBe('passthrough')
  })

  it('leaves ⌘⇧E to the workspace — the terminal owns no palette on it', () => {
    expect(classifyTerminalKey(ev({ key: 'e', ...mod, shiftKey: true }))).toBe('passthrough')
  })

  it('claims ⌘↑ / ⌘↓ for prompt navigation', () => {
    expect(classifyTerminalKey(ev({ key: 'ArrowUp', ...mod }))).toBe('jump-prev')
    expect(classifyTerminalKey(ev({ key: 'ArrowDown', ...mod }))).toBe('jump-next')
  })

  it('leaves →-chords to the shell (word-nav / the shell’s own autosuggest accept)', () => {
    expect(classifyTerminalKey(ev({ key: 'ArrowRight', ctrlKey: true }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 'ArrowRight', metaKey: true }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 'ArrowRight', ctrlKey: true, altKey: true }))).toBe(
      'passthrough',
    )
    expect(classifyTerminalKey(ev({ key: 'ArrowRight', ctrlKey: true, shiftKey: true }))).toBe(
      'passthrough',
    )
  })

  it('passes workspace-level chords THROUGH so they still work from a focused terminal', () => {
    // ⌘⇧P palette, ⌘B sidebar, ⌘J maximize, ⌘⌥P project switcher, ⌘⌥T theme.
    expect(classifyTerminalKey(ev({ key: 'p', ...mod, shiftKey: true }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 'b', ...mod }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 'j', ...mod }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 'p', ...mod, altKey: true }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 't', ...mod, altKey: true }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 'F6' }))).toBe('passthrough')
  })

  it('passes bare typing keys through to the PTY', () => {
    expect(classifyTerminalKey(ev({ key: 'a' }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 'Enter' }))).toBe('passthrough')
    expect(classifyTerminalKey(ev({ key: 'ArrowUp' }))).toBe('passthrough') // shell history, not prompt-nav
  })
})
