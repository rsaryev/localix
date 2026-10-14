/**
 * Pure chord helpers — turn a KeyboardEvent into a canonical chord, match an
 * event against a stored chord, and render a chord as display tokens. All
 * platform-aware shortcut resolution (⌘ vs Ctrl, ⌥ vs Alt) lives HERE so the
 * catalog and persisted overrides stay OS-neutral. OS detection itself is owned
 * by `platform.ts`. See `types.ts` for the chord grammar.
 */

import type { Chord } from './types'
import { OS_FAMILY, type OsFamily } from '../lib/platform'

/**
 * The slice of a keyboard event the chord engine reads. Structural so it accepts
 * both a DOM `KeyboardEvent` and a React `KeyboardEvent` synthetic event.
 */
export interface KeyChordEvent {
  key: string
  /** Physical letter key, used when macOS Option turns its key value into a symbol. */
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type PrimaryModifierEvent = Pick<KeyChordEvent, 'metaKey' | 'ctrlKey'>

/** True only for the current OS's primary accelerator key. */
export function isPrimaryModifier(event: PrimaryModifierEvent, os: OsFamily = OS_FAMILY): boolean {
  return os === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/** Modifier tokens in their fixed canonical order. */
const MODIFIER_ORDER = ['mod', 'secondary', 'alt', 'shift'] as const
const MODIFIER_SET = new Set<string>(MODIFIER_ORDER)

/** Bare modifier keys never form a chord on their own. */
const BARE_MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'OS', 'AltGraph'])

/** Pretty display key names (canonical key → glyph/label). */
const KEY_DISPLAY: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  enter: '↵',
  escape: 'Esc',
  backspace: '⌫',
  delete: 'Del',
  tab: 'Tab',
  space: 'Space',
  ' ': 'Space',
  '`': '`',
}

function normalizeKey(rawKey: string): string {
  if (rawKey === ' ') return 'space'
  return rawKey.toLowerCase()
}

function optionLetter(e: KeyChordEvent, os: OsFamily): string | null {
  if (os !== 'mac' || !e.altKey || !e.code || !/^Key[A-Z]$/.test(e.code)) return null
  // Preserve ordinary layout letters; only recover keys transformed by Option (e.g. x → ≈).
  if (/^[a-z]$/i.test(e.key) || e.key.length !== 1) return null
  return e.code.slice(3).toLowerCase()
}

/**
 * Build a canonical chord from a keydown event, or `null` if the event is just
 * a bare modifier press (so a recorder can keep waiting for the real key).
 */
export function chordFromEvent(e: KeyChordEvent, os: OsFamily = OS_FAMILY): Chord {
  if (BARE_MODIFIER_KEYS.has(e.key)) return null
  const parts: string[] = []
  const mac = os === 'mac'
  if (mac ? e.metaKey : e.ctrlKey) parts.push('mod')
  if (mac ? e.ctrlKey : e.metaKey) parts.push('secondary')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(optionLetter(e, os) ?? normalizeKey(e.key))
  return parts.join('+')
}

interface ParsedChord {
  mod: boolean
  secondary: boolean
  alt: boolean
  shift: boolean
  key: string
}

function parseChord(chord: string): ParsedChord | null {
  const parts = chord.split('+')
  const key = parts[parts.length - 1] ?? ''
  const modifierParts = parts.slice(0, -1)
  if (
    !key ||
    MODIFIER_SET.has(key) ||
    modifierParts.some((modifier) => !MODIFIER_SET.has(modifier)) ||
    new Set(modifierParts).size !== modifierParts.length
  ) {
    return null
  }
  const mods = new Set(modifierParts)
  return {
    mod: mods.has('mod'),
    secondary: mods.has('secondary'),
    alt: mods.has('alt'),
    shift: mods.has('shift'),
    key,
  }
}

/**
 * Re-serialize a chord into canonical form (sorted modifiers, lowercased) so
 * two equivalent strings compare equal regardless of token order. Returns null
 * for an empty/invalid chord.
 */
export function canonicalizeChord(chord: Chord): Chord {
  if (!chord) return null
  const p = parseChord(chord.toLowerCase())
  if (!p) return null
  const out: string[] = []
  for (const m of MODIFIER_ORDER) {
    if (m === 'mod' && p.mod) out.push('mod')
    else if (m === 'secondary' && p.secondary) out.push('secondary')
    else if (m === 'alt' && p.alt) out.push('alt')
    else if (m === 'shift' && p.shift) out.push('shift')
  }
  out.push(p.key)
  return out.join('+')
}

/** True when the live keydown event matches the stored chord. */
export function matchesChord(e: KeyChordEvent, chord: Chord, os: OsFamily = OS_FAMILY): boolean {
  if (!chord) return false
  const p = parseChord(chord)
  if (!p) return false
  const mac = os === 'mac'
  const wantCtrl = mac ? p.secondary : p.mod
  const wantMeta = mac ? p.mod : p.secondary
  if (wantCtrl !== e.ctrlKey || wantMeta !== e.metaKey) return false
  if (p.alt !== e.altKey) return false
  if (p.shift !== e.shiftKey) return false
  return normalizeKey(e.key) === p.key || optionLetter(e, os) === p.key
}

function displayModifier(token: string, os: OsFamily): string {
  const mac = os === 'mac'
  switch (token) {
    case 'mod':
      return mac ? '⌘' : 'Ctrl'
    case 'secondary':
      return mac ? '⌃' : os === 'windows' ? 'Win' : os === 'linux' ? 'Super' : 'Meta'
    case 'alt':
      return mac ? '⌥' : 'Alt'
    case 'shift':
      return mac ? '⇧' : 'Shift'
    default:
      return token
  }
}

export type ChordModifier = (typeof MODIFIER_ORDER)[number]

/** Native label for pointer gestures and other non-key chord instructions. */
export function formatModifierText(modifier: ChordModifier, os: OsFamily = OS_FAMILY): string {
  return displayModifier(modifier, os)
}

function displayKey(key: string): string {
  if (KEY_DISPLAY[key]) return KEY_DISPLAY[key]
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase() // F2, F12
  if (key.length === 1) return key.toUpperCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * Render a chord as ordered display tokens (e.g. ["⌘", "⇧", "O"] on macOS,
 * ["Ctrl", "Shift", "O"] elsewhere). Empty array for an unassigned chord.
 */
export function chordToTokens(chord: Chord, os: OsFamily = OS_FAMILY): string[] {
  if (!chord) return []
  const p = parseChord(chord)
  if (!p) return []
  const tokens: string[] = []
  if (p.mod) tokens.push(displayModifier('mod', os))
  if (p.secondary) tokens.push(displayModifier('secondary', os))
  if (p.alt) tokens.push(displayModifier('alt', os))
  if (p.shift) tokens.push(displayModifier('shift', os))
  tokens.push(displayKey(p.key))
  return tokens
}

/**
 * Render a chord as a single inline string for a plain-text surface (a native
 * `title=` tooltip). macOS packs the glyphs tight (⌘⇧O); other platforms join
 * with `+` (Ctrl+Shift+O). Empty string for an unassigned chord — callers use
 * that to skip the hint entirely rather than print an empty pair of parens.
 */
export function formatChordText(chord: Chord, os: OsFamily = OS_FAMILY): string {
  const tokens = chordToTokens(chord, os)
  if (tokens.length === 0) return ''
  return tokens.join(os === 'mac' ? '' : '+')
}

/**
 * Append a chord hint to a tooltip label — `"Terminal"` → `"Terminal (⌘\`)"`.
 * Returns the label untouched when the chord is unassigned, so an unbound
 * action never gains an empty `()`.
 */
export function withChordHint(title: string, chord: Chord, os: OsFamily = OS_FAMILY): string {
  const text = formatChordText(chord, os)
  return text ? `${title} (${text})` : title
}
