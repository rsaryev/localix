import type { SlashArgOption } from '@localixai/api/slash-catalog'
import type { SlashCommand } from './SlashCommandMenu'

/**
 * Fetch a dynamic arg's options on demand (a plugin `optionsScript` arg, or a
 * built-in whose values are live state). Given the active command, the arg name, the
 * partial text, and the arguments ALREADY committed as chips; returns the option
 * list. The composer wires this up; omit for surfaces with no dynamic args.
 *
 * `committed` is what makes one arg spec serve several sub-commands: `/plugin enable`
 * and `/plugin disable` share the "pick an installed plugin" argument, and only the
 * committed action says which half of the installed set is worth offering.
 */
export type LoadDynamicOptions = (
  command: SlashCommand,
  argName: string,
  query: string,
  committed: Readonly<Record<string, string>>,
) => Promise<SlashArgOption[]>

/**
 * Steps the surface knows do not apply (see `SkipCommandArg`), per command. `/model` passes over
 * its agent step in a one-agent chat; every other command has nothing to skip.
 */
export type SkipArgFor = (
  command: SlashCommand,
  name: string,
  committed: ReadonlyMap<string, string>,
) => boolean
