import { useCapabilities } from './capabilityCache'

/** A plugin command its manifest marks `featured`, as the person types it. */
export interface FeaturedCommand {
  /** What follows the slash, e.g. `<plugin>` or `<plugin>:<name>`. */
  trigger: string
  description: string
}

/**
 * The first featured plugin command of the global scope, or null while none is enabled
 * (or the catalog has not loaded). Core UI teaches the command through this hook so it
 * never names a plugin: whatever the enabled plugins feature is what it shows.
 */
export function useFeaturedCommand(): FeaturedCommand | null {
  const { snapshot } = useCapabilities('')
  const spec = snapshot?.commands.find((command) => command.featured === true)
  return spec ? { trigger: spec.fullName, description: spec.description } : null
}
