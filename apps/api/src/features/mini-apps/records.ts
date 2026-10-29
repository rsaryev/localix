import { normalizeMiniAppSurfaces } from '@localixai/mini-app-sdk/manifest'

import { miniAppIconUrl } from './app-icon'
import { scalarConfig, type CapabilitySourceRecord } from '../capabilities/source-repository'
import { resolveMiniAppConfig } from './config'
import { miniAppOptions } from './config-vault'
import type { MiniAppConfigField, MiniAppRecord } from './contracts'
import type { DiscoveredMiniApp } from './folder'
import type { MiniAppInspections } from './inspection-snapshots'
import { miniAppLoadBlockReason } from './loadable'
import { readMiniAppUiDescriptor } from './ui-artifact'

/** Its declared settings with their values; a secret says only whether it is set. */
export function miniAppConfigFields(
  app: DiscoveredMiniApp,
  state: CapabilitySourceRecord | undefined,
): MiniAppConfigField[] {
  const stored = scalarConfig(state?.config) ?? {}
  return Object.entries(app.manifest?.config ?? {}).map(([key, option]) => {
    const value = stored[key]
    const isSet = value !== undefined && value !== ''
    return {
      key,
      type: option.type,
      description: option.description ?? '',
      required: option.required ?? false,
      secret: option.secret ?? false,
      value: option.secret
        ? null
        : ((value ?? option.default ?? null) as MiniAppConfigField['value']),
      isSet: option.secret ? isSet || miniAppOptions.isSecretHandle(value) : isSet,
      ...(option.title !== undefined ? { title: option.title } : {}),
      ...(option.min !== undefined ? { min: option.min } : {}),
      ...(option.max !== undefined ? { max: option.max } : {}),
    }
  })
}

/**
 * One mini app as the UI shows it. Its code is imported only while it may run (the same gate the
 * loader asks), to read what its backend actually registers; a disabled app shows what its
 * manifest declares.
 */
export async function toMiniAppRecord(input: {
  userId: string
  app: DiscoveredMiniApp
  state: CapabilitySourceRecord | undefined
  enabled: boolean
  awaitingConsent: boolean
  runtimeCwd: string
  inspections: MiniAppInspections
}): Promise<MiniAppRecord> {
  const { app, state, enabled } = input
  const blocked = miniAppLoadBlockReason(app)
  const config = resolveMiniAppConfig(app.manifest?.config, scalarConfig(state?.config))
  const [inspected, ui] = await Promise.all([
    enabled && !blocked && app.backendEntries.length > 0
      ? input.inspections.inspect(app, config, input.userId, input.runtimeCwd)
      : Promise.resolve(null),
    readMiniAppUiDescriptor(app),
  ])
  const error = [blocked, inspected?.error].filter(Boolean).join('; ') || undefined
  return {
    name: app.name,
    ...(app.manifest?.displayName ? { displayName: app.manifest.displayName } : {}),
    ...(app.manifest?.version ? { version: app.manifest.version } : {}),
    description: app.manifest?.description ?? '',
    ...(app.manifest?.category ? { category: app.manifest.category } : {}),
    surfaces: normalizeMiniAppSurfaces(app.manifest?.surfaces),
    scope: app.scope,
    projectId: app.projectId,
    dir: app.dir,
    enabled,
    ...(input.awaitingConsent ? { awaitingConsent: true } : {}),
    ...(error ? { error } : {}),
    hasBackend: app.backendEntries.length > 0,
    tools: inspected?.tools ?? [],
    backendSubsystems: inspected?.backendSubsystems ?? [],
    commands: app.commands.map((command) => command.name),
    views: app.views.map((view) => view.id),
    hasGuide: app.guide !== undefined,
    ...(miniAppIconUrl(app) ? { icon: miniAppIconUrl(app) } : {}),
    ...(ui ? { ui } : {}),
    config: miniAppConfigFields(app, state),
  }
}
