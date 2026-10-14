/**
 * Manifest registry: bundled manifests, shadowable by a local override.
 *
 * A local override replaces a bundled manifest and always wins. Overrides live in the plugin's own
 * state dir as JSON, since the plugin has a state dir and no TOML parser.
 *
 * There is deliberately NO remote manifest fetching. That would be a background network call to a
 * third-party host to change how local processes are classified; it is not something a plugin
 * should do without the user asking. Bundled + local override only.
 *
 * An invalid override file is ignored with a warning and the bundled manifest for that agent stays
 * in force: a bad override never removes detection, it just does not apply.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DetectionManifest } from './manifest-types'
import { claudeCodeManifest } from './manifests/claude-code'
import { codexManifest } from './manifests/codex'
import { geminiCliManifest } from './manifests/gemini-cli'
import { githubCopilotManifest } from './manifests/github-copilot'
import { hermesManifest } from './manifests/hermes'
import { opencodeManifest } from './manifests/opencode'

/**
 * Exported so `manifests/upstream-inventory.test.ts` can hold what SHIPS against the recorded rule
 * inventory. Importing the files directly there would leave a new manifest unguarded.
 */
export const BUNDLED_MANIFESTS: readonly DetectionManifest[] = [
  claudeCodeManifest,
  codexManifest,
  opencodeManifest,
  geminiCliManifest,
  githubCopilotManifest,
  hermesManifest,
]

export class ManifestRegistry {
  private readonly stateDir: string
  private readonly log: (message: string) => void
  private readonly resolved = new Map<string, DetectionManifest>()

  constructor(stateDir: string, log: (message: string) => void) {
    this.stateDir = stateDir
    this.log = log
    for (const manifest of BUNDLED_MANIFESTS) this.resolved.set(manifest.id, manifest)
  }

  /** Directory a user drops `<manifestId>.json` into to shadow a bundled manifest. */
  overrideDir(): string {
    return join(this.stateDir, 'detection')
  }

  get(manifestId: string | undefined): DetectionManifest | undefined {
    if (!manifestId) return undefined
    return this.resolved.get(manifestId)
  }

  list(): readonly DetectionManifest[] {
    return [...this.resolved.values()]
  }

  /**
   * Load overrides once at boot. Not on every evaluation: reading two files per screen snapshot,
   * several times a second while an agent works, would be pure waste for data that changes when a
   * human edits a file.
   */
  async loadOverrides(): Promise<void> {
    for (const bundled of BUNDLED_MANIFESTS) {
      const path = join(this.overrideDir(), `${bundled.id}.json`)
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch {
        continue // no override for this kind — the common case
      }
      try {
        const parsed = JSON.parse(raw) as DetectionManifest
        if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
          throw new Error('override has no rules')
        }
        this.resolved.set(bundled.id, {
          ...parsed,
          id: bundled.id,
          displayName: parsed.displayName || bundled.displayName,
          version: parsed.version || 'override',
          overridden: true,
        })
        this.log(`external-agents: detection manifest "${bundled.id}" overridden from ${path}`)
      } catch (error) {
        this.log(
          `external-agents: ignoring invalid detection override ${path} (${String(error)}); using the bundled manifest`,
        )
      }
    }
  }
}
