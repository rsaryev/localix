/**
 * THE ONE POINT AN AGENT OR SKILL `model:` VALUE BECOMES A MODEL ID, as Claude Code reads it
 * (sub-agents.md, "Choose a model"): an alias (`sonnet`, `opus`, `haiku`, `fable`), `inherit`, or a
 * full id. Reading the value is the plugin kit's (`plugins/kit/model-alias.ts`), installed here at
 * boot (A4: the composition root wires it), so agent-core never imports the kit.
 *
 * Until a resolver is installed nothing is read as a model: every value is the parent's model, so a
 * child never starts on an alias word no provider serves.
 */
export interface ModelAliasResolver {
  /**
   * The model a `model:` value runs on, given the parent's model and the ids the providers offer.
   * `undefined` only when the value inherits and no parent model is known.
   */
  resolve(
    value: string | undefined,
    parentModelId: string | undefined,
    availableModelIds?: readonly string[],
  ): string | undefined
}

let installed: ModelAliasResolver | undefined

/** Install (or, with `undefined`, remove) the host's resolver. One per process, set at boot. */
export function installModelAliasResolver(resolver: ModelAliasResolver | undefined): void {
  installed = resolver
}

/** Resolve an agent/skill `model:` value to a concrete model id through the installed resolver. */
export function resolveModelAlias(
  value: string | undefined,
  parentModelId: string | undefined,
  availableModelIds?: readonly string[],
): string | undefined {
  return installed ? installed.resolve(value, parentModelId, availableModelIds) : parentModelId
}
