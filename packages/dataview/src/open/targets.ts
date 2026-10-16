/**
 * Catalog of "open in native app" targets — agnostic DATA only. The set of apps
 * and which export format each needs lives here; the actual installed-detection
 * (fs / PATH) and process spawn happen in the API layer, which reads this catalog.
 * Scalable: add an app by appending a target — no launcher rewrite for the common
 * `open -a` (macOS) / binary (linux) cases.
 */

import { EXPORT_FORMATS } from '../export/registry'

export type OpenPlatform = 'darwin' | 'win32' | 'linux'

export type OpenMode =
  | 'default' // open in the OS default app for the file type
  | 'app' // open in a specific named application
  | 'reveal' // reveal/select the file in the OS file manager

export interface OpenTarget {
  id: string
  label: string
  mode: OpenMode
  /** Platforms where this target is offered. */
  platforms: OpenPlatform[]
  /**
   * Which exporter (registry id) to serialize the table with before opening — see
   * `EXPORT_FORMATS`. The host resolves it as `registry.get(target.exporterId)`, so a
   * value with no registered exporter is a silent, type-clean dead end; `dataview.test.ts`
   * pins every target's id against the default registry.
   */
  exporterId: string
  /** mode:'app' — application name/binary per platform (used to build the spawn). */
  app?: Partial<Record<OpenPlatform, string>>
  /** mode:'app' — macOS .app bundle paths whose existence proves availability. */
  bundlePaths?: Partial<Record<OpenPlatform, string[]>>
  /** mode:'app' — binaries to resolve on PATH to prove availability. */
  binaries?: Partial<Record<OpenPlatform, string[]>>
}

export const OPEN_TARGETS: readonly OpenTarget[] = [
  {
    id: 'system-default',
    label: 'System default app',
    mode: 'default',
    platforms: ['darwin', 'win32', 'linux'],
    exporterId: EXPORT_FORMATS.csv,
  },
  {
    id: 'reveal',
    label: 'Show in file manager',
    mode: 'reveal',
    platforms: ['darwin', 'win32', 'linux'],
    exporterId: EXPORT_FORMATS.csv,
  },
  {
    id: 'numbers',
    label: 'Numbers',
    mode: 'app',
    platforms: ['darwin'],
    // Native spreadsheet apps get a real .xlsx (types + multi-sheet fidelity),
    // not a lossy CSV. The bytes are serialized host-side (SheetJS).
    exporterId: EXPORT_FORMATS.xlsx,
    app: { darwin: 'Numbers' },
    bundlePaths: { darwin: ['/Applications/Numbers.app', '/System/Applications/Numbers.app'] },
  },
  {
    id: 'excel',
    label: 'Microsoft Excel',
    mode: 'app',
    platforms: ['darwin'],
    exporterId: EXPORT_FORMATS.xlsx,
    app: { darwin: 'Microsoft Excel' },
    bundlePaths: { darwin: ['/Applications/Microsoft Excel.app'] },
  },
  {
    id: 'libreoffice',
    label: 'LibreOffice Calc',
    mode: 'app',
    platforms: ['darwin', 'linux', 'win32'],
    exporterId: EXPORT_FORMATS.xlsx,
    app: { darwin: 'LibreOffice', linux: 'libreoffice', win32: 'soffice' },
    bundlePaths: { darwin: ['/Applications/LibreOffice.app'] },
    binaries: { linux: ['libreoffice', 'soffice'], win32: ['soffice.exe', 'soffice'] },
  },
]

/** Targets offered on a platform (pre-detection — API verifies app availability). */
export function openTargetsForPlatform(platform: OpenPlatform): OpenTarget[] {
  return OPEN_TARGETS.filter((t) => t.platforms.includes(platform))
}

export function getOpenTarget(id: string): OpenTarget | undefined {
  return OPEN_TARGETS.find((t) => t.id === id)
}
