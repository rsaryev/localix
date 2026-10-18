import { workspaceCapabilities } from './plugin-workspace-capabilities'
import { agentTerminalOf } from '../features/terminal/agent-scope'
import type { loadPluginBackends } from '../features/plugins/loader'
import type { createPluginWakes } from '../features/plugins/plugin-wake'
import { bindPluginMonitors } from '../features/plugins/monitor-arms'
import { resolvePluginSessionDataDir } from '../features/plugins/session-storage'
import { bootAgentDirectory } from './plugin-agent-directory'
import { watchPathNative } from '../features/fs-watch/path-watch'
import { openPath, openPathWith, revealPath } from '../features/projects/native-dialogs'
import type { createSecretsStore } from '../features/secrets/store'
import type { createSecretExposureShield } from '../features/secrets/exposure-shield'
import type { createMediaStore } from '../features/media/store'
import type { BootstrapServiceRefs } from './chat-service-deps'
import type { PluginHostRefs } from './plugin-host-refs'
import type { PluginChangeHosts } from '../features/changes/plugin-host'
import type { SemanticService } from '../features/embeddings/service'
import { createPluginSemanticHost } from '../features/embeddings/plugin-host'

type HostForPlugin = Parameters<typeof loadPluginBackends>[0]['hostForPlugin']

/**
 * The host services one plugin's backend receives: generic seams that let a backend resolve named
 * secrets, read terminals, store session data and access media by id without importing the owning
 * core subsystems.
 *
 * Built per plugin load so every activation receives live, identity-bound Vault authority; no
 * plugin keeps a bootstrap snapshot of another plugin's audit actor. Its own module because the
 * plugin-hosts phase that wires it grew past the size ratchet with it inline.
 */
export function createPluginHostServices(deps: {
  hostRefs: PluginHostRefs
  serviceRefs: BootstrapServiceRefs
  secretsStore: ReturnType<typeof createSecretsStore>
  secretExposureShield: ReturnType<typeof createSecretExposureShield>
  mediaStore: ReturnType<typeof createMediaStore>
  pluginWakes: ReturnType<typeof createPluginWakes>
  semanticService: SemanticService
  /** Each plugin's own change feed (`host.changes`). */
  changes: PluginChangeHosts
}): HostForPlugin {
  const { hostRefs, serviceRefs, secretsStore, secretExposureShield, mediaStore, pluginWakes } =
    deps
  return (pluginName) => ({
    ...workspaceCapabilities(hostRefs),
    // The same ownership-checked reader the interactive `terminal` tool uses, minus every
    // write. A plugin that watches external agents could otherwise only see the screens the
    // MODEL happened to look at, which makes its state an observation log rather than a
    // reading.
    terminalRead: {
      // Resolved through the SAME agent boundary the interactive terminal tool uses
      // (terminal/agent-scope.ts): the service owns panes per USER, so without the session
      // component a plugin could read a pane belonging to another chat.
      screen: async ({ userId, sessionId, terminalId }) =>
        (await agentTerminalOf(
          serviceRefs.terminalService,
          userId,
          sessionId,
          terminalId,
        )?.screen()) ?? null,
      finalScreen: async ({ userId, sessionId, terminalId }) => {
        // `get()` returns undefined for exactly the ids the archive holds, so the session
        // claim is checked against the ARCHIVED record, which still carries it.
        if (!sessionId) return null
        const archived = serviceRefs.terminalService?.archivedTerminal(userId, terminalId)
        if (!archived || archived.chatSessionId !== sessionId) return null
        return (await serviceRefs.terminalService?.finalScreen(userId, terminalId)) ?? null
      },
      list: ({ userId, sessionId }) =>
        (serviceRefs.terminalService?.list(userId) ?? []).flatMap((t) =>
          t.chatSessionId === sessionId ? [{ terminalId: t.id, command: t.command }] : [],
        ),
    },
    sessionStorage: {
      resolveDataDir: (...args) =>
        resolvePluginSessionDataDir({
          pluginName,
          userId: args[0],
          sessionId: args[1],
          authorize: (...authorizeArgs) =>
            hostRefs.chatService!.resolveSessionCwd(...authorizeArgs),
        }),
    },
    agents: bootAgentDirectory(hostRefs),
    // Confined to the plugin's own `plugin:<name>:*` collections.
    semantic: createPluginSemanticHost(deps.semanticService, pluginName),
    // The plugin's own stream, `plugin:<name>`: record notices, read them at a durable cursor.
    changes: deps.changes.forPlugin(pluginName),
    // The native watcher only the host bundles; a plugin's own `fs.watch` drops bursts on macOS.
    watchPath: watchPathNative,
    files: {
      open: openPath,
      openWith: openPathWith,
      reveal: revealPath,
    },
    // `consumer` is the plugin naming WHAT of its own is using the key. Folded into the
    // audit context so the vault's activity log says "api-request github-user" instead of
    // naming only the extension — one actor for many saved objects told nobody anything. The
    // plugin name stays the ACTOR either way; only the consumer narrows.
    resolveSecret: async (userId, key, consumer) => {
      const value = await secretsStore.resolve(userId, key, {
        actorType: 'plugin',
        actorId: pluginName,
        consumerType: consumer?.type ?? 'plugin',
        consumerId: consumer?.id ?? pluginName,
      })
      if (value) secretExposureShield.remember(userId, value)
      return value ?? undefined
    },
    // Record that a plugin object REFERENCES a key. Grants nothing — it is what lets the
    // vault answer "what breaks if I delete this?", which it already refuses to do blindly
    // (`remove` reports `in_use`). The binding table has existed unused; this is its first
    // writer, so a referenced credential finally has a visible consumer.
    bindSecret: (userId, key, consumer) =>
      secretsStore.bind(userId, key, {
        consumerType: consumer.type,
        consumerId: consumer.id,
        field: consumer.field,
        label: consumer.label ?? consumer.id,
      }),
    // The create-only half of the vault (`setIfAbsent`, never `set`), so a plugin can move a
    // literal the user pasted into it out of its own plaintext store — without being able to
    // overwrite a key it does not own.
    storeSecret: async (userId, key, value) => {
      const stored = await secretsStore.setIfAbsent(userId, key, value, {
        label: key,
        type: 'secret',
        source: 'plugin',
        tags: ['plugin', pluginName],
        audit: {
          actorType: 'plugin',
          actorId: pluginName,
          consumerType: 'plugin',
          consumerId: pluginName,
        },
      })
      // Its sibling `resolveSecret` above registers on read; this half did not, so a plugin that
      // stored a literal and used it in the SAME operation went unshielded until some later
      // resolve. Only on success, for the reason spelled out at the runtime `storeSecret`.
      if (stored) secretExposureShield.remember(userId, value)
      return stored
    },
    // A turn the plugin asks for, answered through its own tools (plugin-wake.ts).
    wake: pluginWakes.forPlugin(pluginName),
    // Which session the plugin's manifest monitors report to — its own monitors, a session the
    // user owns (monitor-arms.ts). Without an arm a monitor's lines reach no one.
    monitors: bindPluginMonitors({
      pluginName,
      host: () => hostRefs.monitorHost,
      resolveSessionCwd: async (...args) =>
        (await hostRefs.chatServiceForCwd?.resolveSessionCwd(...args)) ?? null,
    }),
    media: {
      getBytes: async (...args) => {
        const b64 = await mediaStore.getBase64(...args)
        return b64 ? new Uint8Array(Buffer.from(b64, 'base64')) : null
      },
      putBytes: async (bytes, mediaType) => ({
        id: (await mediaStore.putBase64(Buffer.from(bytes).toString('base64'), mediaType)).id,
      }),
    },
  })
}
