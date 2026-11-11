import { modelFamily, modelValueKind, type ModelAlias } from '@rsaryev/llx-plugin/agents'
import type { ModelAliasResolver } from '../../agent-core/model-alias'

/**
 * An agent or skill `model:` value read as Claude Code reads it (sub-agents.md, "Choose a model"),
 * through the kit's `modelValueKind` and `modelFamily`: `inherit` (or no value) is the parent's
 * model; an alias of the parent's own family is the parent's exact model, `[1m]` suffix and all;
 * another alias is the newest model of that family the providers offer, else the parent's; a full
 * id is itself. Which offered model is newest is Localix's: the kit has no catalog of providers.
 */

/** A numeric group this long is a release DATE stamp (`20250514`), not a version number. */
const DATE_STAMP_DIGITS = 8

/** Split an id's numeric groups into version numbers and a trailing date stamp. */
function versionParts(id: string): { version: number[]; date: number } {
  const version: number[] = []
  let date = -1
  for (const group of id.match(/\d+/g) ?? []) {
    if (group.length >= DATE_STAMP_DIGITS) date = Number(group)
    else version.push(Number(group))
  }
  return { version, date }
}

/**
 * Compare two ids by their version numbers, then their release date stamp, then lexically —
 * larger = newer. A date stamp never competes with a version number: `claude-opus-4-20250514`
 * is version 4 (dated), older than version 4.5 (`claude-opus-4-5`).
 */
function compareVersionish(a: string, b: string): number {
  const pa = versionParts(a)
  const pb = versionParts(b)
  const len = Math.max(pa.version.length, pb.version.length)
  for (let i = 0; i < len; i++) {
    const d = (pa.version[i] ?? -1) - (pb.version[i] ?? -1)
    if (d !== 0) return d
  }
  if (pa.date !== pb.date) return pa.date - pb.date
  return a.localeCompare(b)
}

/** The newest offered model of a family (`modelFamily`), or undefined when none is of it. */
export function bestModelForFamily(
  family: ModelAlias,
  availableModelIds: readonly string[],
): string | undefined {
  return availableModelIds
    .filter((id) => modelFamily(id) === family)
    .sort((a, b) => compareVersionish(b, a))[0]
}

export const modelAliasResolver: ModelAliasResolver = {
  resolve(value, parentModelId, availableModelIds = []) {
    const text = value?.trim()
    if (!text) return parentModelId
    const kind = modelValueKind(text)
    if (kind === 'inherit') return parentModelId
    if (kind === 'full-id') return text
    const family = text as ModelAlias
    if (parentModelId && modelFamily(parentModelId) === family) return parentModelId
    return bestModelForFamily(family, availableModelIds) ?? parentModelId
  },
}
