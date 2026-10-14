import {
  capabilitySettingsUiUri,
  localixResourceUri,
  settingsUiUri,
} from '@localixai/plugin-sdk/navigation'
import type { CapabilityResourceKind } from '@localixai/plugin-sdk/navigation'
import type { ComposerTipAction } from './contracts'

/**
 * The action builders every tip uses, so no tip spells a destination by hand.
 *
 * A URI typed into a tip is a link that works until someone renames a settings tab,
 * and nothing fails when it breaks — the client simply cannot resolve it and the
 * button disappears, silently. These builders come from the SDK's navigation module,
 * the same one the capability rows, drag bindings and `/open` results are built from,
 * so a destination is wrong here only if it is wrong everywhere.
 */

/** Stage text in the composer for the user to edit and send. Never sends it. */
export function insertAction(text: string, label = text): ComposerTipAction {
  return { kind: 'insert', label, text }
}

/** Open one settings tab. */
export function settingsAction(tab: string, label: string): ComposerTipAction {
  return { kind: 'navigate', label, uri: settingsUiUri(tab) }
}

/**
 * Open the settings ROW of one capability — the plugin that is off, the skill just
 * mentioned — rather than its tab. A tip that says "enable X" should land on X, not
 * on a list the user then has to search.
 */
export function capabilityAction(
  kind: CapabilityResourceKind,
  id: string,
  scope: string,
  label: string,
): ComposerTipAction {
  return { kind: 'navigate', label, uri: capabilitySettingsUiUri({ kind, id, scope }) }
}

/**
 * Open the vault workspace.
 *
 * A resource URI rather than a settings one, because that is where the vault actually
 * lives — it is a work item with its own anchor, not a settings tab. Built with the
 * same helper its anchor compares against, which is the only reason this can be
 * trusted to resolve: the anchor matches the string exactly.
 */
export function vaultAction(label: string): ComposerTipAction {
  return { kind: 'navigate', label, uri: localixResourceUri('vault', ['items']) }
}
