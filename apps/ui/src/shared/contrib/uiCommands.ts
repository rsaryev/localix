import type { UiAnchorOverlayParam, UiLocationEffect } from '@localixai/mini-app-sdk/ui'
import { localixUiUri } from '@localixai/mini-app-sdk/navigation'

export type UiCommandParams = Readonly<Record<string, UiAnchorOverlayParam>>

/** A runnable workspace action rendered by the command palette. */
export interface PaletteCommand {
  id: string
  label: string
  group: string
  /** Mandatory security classification; unclassified commands do not compile. */
  effect: UiLocationEffect
  chordId?: string
  keywords?: string[]
  run: (params?: UiCommandParams) => void
}

/** Minimal subset retained by global search and URI-anchor activation. */
export type UiCommandEntry = Omit<PaletteCommand, 'chordId' | 'group'> & { group?: string }

/** Canonical URL for one live command, classified by its declared effect. */
export function uiCommandUri(command: Pick<UiCommandEntry, 'id' | 'effect'>): string {
  return command.effect === 'write'
    ? localixUiUri('action', ['command', command.id])
    : localixUiUri('command', [command.id])
}

let commands: UiCommandEntry[] = []
let revision = 0
const listeners = new Set<() => void>()

export function setUiCommands(next: UiCommandEntry[]): void {
  const ids = new Set<string>()
  for (const entry of next) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(entry.id) ||
      !entry.label.trim() ||
      entry.label.length > 120 ||
      (entry.effect !== 'read' && entry.effect !== 'write') ||
      typeof entry.run !== 'function'
    ) {
      throw new Error(`[ui-commands] invalid required metadata for "${entry.id || 'unknown'}"`)
    }
    if (ids.has(entry.id)) {
      throw new Error(`[ui-commands] duplicate id "${entry.id}"`)
    }
    ids.add(entry.id)
  }
  commands = next.map((entry) => ({
    ...entry,
    ...(entry.keywords ? { keywords: [...entry.keywords] } : {}),
  }))
  revision += 1
  listeners.forEach((listener) => listener())
}

export function getUiCommands(): UiCommandEntry[] {
  return commands.map((entry) => ({
    ...entry,
    ...(entry.keywords ? { keywords: [...entry.keywords] } : {}),
  }))
}

export function uiCommandRevision(): number {
  return revision
}

export function subscribeUiCommands(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function hasUiCommand(id: string, allowWrite = false): boolean {
  return commands.some(
    (entry) =>
      entry.id === id && (entry.effect === 'read' || (entry.effect === 'write' && allowWrite)),
  )
}

export function uiCommandEffect(id: string): UiLocationEffect | null {
  const command = commands.find((entry) => entry.id === id)
  return command?.effect === 'read' || command?.effect === 'write' ? command.effect : null
}

export function runUiCommand(id: string, allowWrite = false, params?: UiCommandParams): boolean {
  const command = commands.find((entry) => entry.id === id)
  if (
    !command ||
    (command.effect !== 'read' && command.effect !== 'write') ||
    (command.effect === 'write' && !allowWrite)
  ) {
    return false
  }
  command.run(params)
  return true
}
