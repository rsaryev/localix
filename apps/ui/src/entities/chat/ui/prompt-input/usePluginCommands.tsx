import { useMemo } from 'react'
import { useChatStore } from '@/entities/chat/model/store'
import { selectComposerProjectId } from './commandScope'
import type { PluginCommandArgSpec, PluginCommandSpec } from '@/shared/api/contracts'
import { useCapabilities } from '@/shared/contrib/capabilityCache'
import { openStore } from '@/shared/lib/openStore'

const NO_COMMANDS: PluginCommandSpec[] = []
import type { SlashCommand } from './SlashCommandMenu'
import type { SlashArgSpec } from './SlashArgSpec'
import { PluginsIcon } from './commandIcons'

/**
 * Convert a backend plugin command arg spec into the composer's `SlashArgSpec`.
 * Choice args carry their option list; text args are free-form (always last).
 */
export function mapArgs(args: PluginCommandArgSpec[]): SlashArgSpec[] {
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
 * A plugin that is installed but waits for its OK has loaded none of its commands, so typing one
 * would show nothing. One row names the plugin instead and opens its Store page, where the OK is
 * given. The Store lists a plugin as `<plugin>@<marketplace>`, which the capability document
 * records as its source; one it cannot place there opens the Plugins shelf.
 */
function awaitingConsentRows(
  plugins: ReadonlyArray<{ name: string; source: string; awaitingConsent?: boolean }>,
): SlashCommand[] {
  return plugins
    .filter((plugin) => plugin.awaitingConsent)
    .map((plugin): SlashCommand => {
      const message = `${plugin.name} is waiting for your OK`
      return {
        id: `plugin:awaiting:${plugin.name}`,
        trigger: plugin.name,
        title: message,
        description: message,
        icon: <PluginsIcon />,
        kind: 'builtin',
        onChoose: () =>
          openStore(
            plugin.source.includes('@')
              ? { ref: { kind: 'plugin', id: plugin.source } }
              : { shelf: 'package:plugin' },
          ),
      }
    })
}

/**
 * Fetches slash commands declared by enabled Claude Code plugins and exposes them as composer
 * commands (a mini app's are `useMiniAppCommands`). They are `kind: 'builtin'` so the picker inserts their namespaced
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
  const plugins = snapshot?.plugins

  return useMemo(
    () => [
      ...commands.map((spec): SlashCommand => ({
        id: `plugin:${spec.fullName}`,
        trigger: spec.fullName,
        title: spec.fullName,
        description: spec.description || `From ${spec.pluginName}`,
        icon: <PluginsIcon />,
        kind: 'builtin',
        prefix: `/${spec.fullName} `,
        args: mapArgs(spec.args),
        ...(spec.featured ? { featured: true } : {}),
      })),
      ...awaitingConsentRows(plugins ?? []),
    ],
    [commands, plugins],
  )
}
