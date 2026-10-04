import type { PluginHostServices } from '@localixai/plugin-sdk/backend'
import type { PluginHostRefs } from './plugin-host-refs'

/**
 * The two workspace capabilities a plugin backend may hold, built from the late-bound host refs.
 *
 * They are deliberately SEPARATE seams rather than one. `workspaceScope` answers "where does this
 * id live?" for an id the caller already has — the narrow thing a session- or project-scoped
 * provider needs. `workspaces` also ENUMERATES, which a resource provider whose roots are the
 * user's projects cannot avoid: it is handed nothing but a userId. Folding enumeration into the
 * scope host would hand every consumer of a narrow resolver the ability to list a whole workspace.
 *
 * Both read through `hostRefs` rather than capturing a service, because the chat and projects
 * services are created after the plugin host phase and rebind on reload.
 */
export function workspaceCapabilities(
  hostRefs: PluginHostRefs,
): Pick<PluginHostServices, 'workspaceScope' | 'workspaces'> {
  // Every session-half door goes through the chat service's `sessionCoordination`. Reading it per
  // call rather than destructuring it once is what keeps a plugin working across a chat-service
  // rebind — the ref is replaced, not mutated.
  const coordination = () => hostRefs.chatServiceForCwd?.sessionCoordination
  return {
    workspaceScope: {
      resolveSessionRoot: async (...args) =>
        (await hostRefs.chatServiceForCwd?.resolveSessionCwd(...args).catch(() => null)) ?? null,
      resolveProjectRoot: async (...args) =>
        (await hostRefs.resolveProjectCwd?.(...args).catch(() => null)) ?? null,
    },
    workspaces: {
      listProjects: async (...args) =>
        (await hostRefs.listProjects?.(...args).catch(() => [])) ?? [],
      resolveProjectDirectory: async (...args) =>
        (await hostRefs.resolveProjectCwd?.(...args).catch(() => null)) ?? null,

      // ── The session half ────────────────────────────────────────────────────────────────────
      // Answered, not absent: a provider that reads a session's directory checks for it at
      // construction and disables itself when it is missing, so a half-supplied seam reads to the
      // user as a feature that silently vanished.
      resolveSessionDirectory: async (...args) =>
        (await hostRefs.chatServiceForCwd?.resolveSessionCwd(...args).catch(() => null)) ?? null,
      readSessionMetadata: async (...args) =>
        (await coordination()?.readSessionMetadata(...args)) ?? null,
    },
  }
}
