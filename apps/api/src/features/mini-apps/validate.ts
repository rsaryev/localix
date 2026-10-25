import { checkApiVersion } from '../ext/manifest-validate'
import { MINI_APP_API_VERSION } from './contracts-base'
import type { DiscoveredMiniApp } from './discovery'

export interface MiniAppValidation {
  errors: string[]
  warnings: string[]
}

/**
 * A mini app's static checks, without importing its code: its manifest, its host API version, the
 * agents it contributes, and names that must be unique (views, a command's arguments, prompt
 * section titles). What Settings → Mini apps shows under the app.
 */
export function validateMiniApp(app: DiscoveredMiniApp): MiniAppValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (app.error) errors.push(app.error)
  if (!app.manifest) return { errors, warnings }
  checkApiVersion('Mini app', MINI_APP_API_VERSION, app.manifest.apiVersion, errors, warnings)

  const duplicates = (bucket: string[], kind: string, values: string[], suffix: string) => {
    const seen = new Set<string>()
    for (const value of values) {
      if (seen.has(value)) bucket.push(`Duplicate ${kind} "${value}" — ${suffix}.`)
      seen.add(value)
    }
  }
  duplicates(
    errors,
    'view',
    app.views.map((view) => view.id),
    'must be unique within a mini app',
  )
  for (const command of app.commands)
    duplicates(
      errors,
      `command "${command.name}" arg`,
      command.args.map((arg) => arg.name),
      'must be unique within a command',
    )
  duplicates(
    warnings,
    'promptSection title',
    app.promptSections.map((section) => section.title),
    'use distinct titles to avoid redundant system-prompt sections',
  )
  for (const section of app.promptSections)
    if (!section.content.trim())
      warnings.push(`promptSection "${section.title}" has whitespace-only content.`)
  // Static text in the shared system prompt, every run: per-run context belongs to a Context
  // Fabric provider (`contextProviders`), which is scoped, budgeted and filtered.
  if (app.promptSections.length > 0)
    warnings.push(
      'promptSections inject static text into the shared system prompt (capped at 3×2000 chars). For dynamic or per-resource context prefer a Context Fabric provider (contextProviders).',
    )
  if (app.guide === undefined)
    warnings.push('No guide.md: the agent learns the app only from its tool descriptions.')
  return { errors, warnings }
}
