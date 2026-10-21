import { useMemo } from 'react'
import { useChatStore } from '@/entities/chat/model/store'
import { selectComposerProjectId } from './commandScope'
import type { PluginCommandArgSpec, PluginCommandSpec } from '@/shared/api/contracts'
import { useCapabilities } from '@/shared/contrib/capabilityCache'

const NO_COMMANDS: PluginCommandSpec[] = []
import type { SlashCommand } from './SlashCommandMenu'
import type { SlashArgSpec } from './SlashArgSpec'
import { PluginsIcon } from './commandIcons'

/**
 * Convert a backend plugin command arg spec into the composer's `SlashArgSpec`.
 * Choice args carry their option list; text args are free-form (always last).
 */
function mapArgs(args: PluginCommandArgSpec[]): SlashArgSpec[] {
  const mapped = args.map((arg): SlashArgSpec => {
    if (arg.type === 'choice') {
      return {
        name: arg.name,
        type: 'choice',
        // A dynamic arg's options load on demand — start empty; useSlashArgs fetches.
        options: (arg.options ?? []).map((o) => ({
          value: o.value,
          label: o.label ?? o.value,
          description: o.description,
        })),
        placeholder: arg.placeholder,
        ...(arg.dynamic ? { dynamic: true } : {}),
        ...(arg.when ? { when: arg.when } : {}),
      }
    }
    return {
      name: arg.name,
      type: 'text',
      placeholder: arg.placeholder,
      ...(arg.when ? { when: arg.when } : {}),
    }
  })
  // Always leave a trailing free-text slot so the user can type a prompt after the
  // command — Claude Code-style flat-file commands declare no args but their body uses
  // `$ARGUMENTS` (e.g. /feature-dev), which the backend fills from this text. Without it
  // the composer has nowhere to type once the declared (choice) args are satisfied.
  if (!mapped.some((a) => a.type === 'text')) {
    mapped.push({ name: 'arguments', type: 'text', placeholder: 'arguments…' })
  }
  return mapped
}

/**
 * Fetches slash commands declared by enabled plugins and exposes them as composer
 * commands. They are `kind: 'builtin'` so the picker inserts their namespaced
 * prefix (`/<plugin>:<cmd> `) and the message flows through the normal arg engine
 * + sendMessage path — the backend dispatches them generically.
 */
export function usePluginCommands(sessionId: string | null, enabled = true): SlashCommand[] {
  const projectId = useChatStore((state) => selectComposerProjectId(state, sessionId))
  // The composer's scope is not always the workbench's, so this reads through the
  // shared capability cache: same scope as the open project ⇒ the document the
  // workbench already holds, another scope ⇒ one request shared with every other
  // reader of it. This used to be its own endpoint, its own retry loop and its own
  // copy of "which contributions are enabled".
  const { snapshot } = useCapabilities(projectId ?? '', enabled)
  const commands = snapshot?.commands ?? NO_COMMANDS

  return useMemo(
    () =>
      commands.map(
        (spec): SlashCommand => ({
          id: `plugin:${spec.fullName}`,
          trigger: spec.fullName,
          title: spec.fullName,
          description: spec.description || `From ${spec.pluginName}`,
          icon: <PluginsIcon />,
          kind: 'builtin',
          prefix: `/${spec.fullName} `,
          args: mapArgs(spec.args),
          ...(spec.featured ? { featured: true } : {}),
          ...(spec.args.some((a) => a.dynamic)
            ? { argSource: { plugin: spec.pluginName, command: spec.name } }
            : {}),
        }),
      ),
    [commands],
  )
}
