import type { PluginWorkspaceSnapshot } from '@localixai/plugin-sdk/ui'
import { createPluginFilesRuntime } from './pluginRuntimeFiles'
import { pluginUiComponents } from './pluginUiComponents'
import { terminal as terminalBus } from '@/shared/lib/terminalBus'
import {
  bindPluginUiComponents,
  bindPluginUiRuntime,
  bindPluginUiToast,
  bindPluginUiTransport,
} from '@localixai/plugin-sdk/ui'

import { backendClient } from '@/shared/api/client'
import { completionWorkingSet } from '@/shared/api/completionWorkingSet'
import { useInlineCompletion } from '@/shared/hooks/useInlineCompletion'
import { eventSocket } from '@/shared/api/eventSocket'
import { API_BASE_URL, apiFetch } from '@/shared/api/internal'
import { projectsApi } from '@/shared/api/projects-client'
import { secretsApi } from '@/shared/api/secretsApi'
import { composerBus } from '@/shared/lib/composerBus'
import {
  inspector,
  type DiffProvenanceRequest,
  type OpenDiffRequest,
} from '@/shared/lib/inspectorBus'
import { toast } from '@/shared/lib/notify'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { openSidebarSection } from '@/shared/lib/sidebarSectionBus'
import { terminal } from '@/shared/lib/terminalBus'
import { useChatStore } from '@/entities/chat/model/store'
import { revealPreview } from '@/features/inspector/model/revealPreview'
import { revealJobSession } from '@/entities/chat/model/useJobTerminal'
import { openTranscript } from '@/entities/chat/model/openTranscript'
import { focusedVisibleTabId, useGridStore } from '@/entities/workspace-grid/model'
import { isSectionId, resolveNavScope, scopePath } from '@/shared/routing/routes'
import { useSettingsStore } from '@/shared/lib/user-settings/settingsStore'
import { isModelRoutingTaskEnabled } from '@localixai/api/model-task-catalog'
import { assertPluginOwnedWorkItemInstance } from '@/shared/contrib/uiContrib'
import { createPluginToast } from '@/shared/contrib/pluginToast'
import { openFileInGrid } from '@/shared/lib/recentFiles'
import { refFromContextBinding } from '@/entities/chat/model/sendRefs'
import { refOpenAction } from '@/entities/chat/ui/refKindPresentation'

// Composition root for the public plugin UI SDK. Plugins depend only on SDK
// capabilities; the application owns the concrete stores, clients, and buses
// that implement them.
bindPluginUiComponents(pluginUiComponents)
// Wrapped, not the host's own: every plugin shares this one surface, and the wrapper is what names
// the calling plugin on each row instead of filing it as "System" (see `pluginToast.ts`).
bindPluginUiToast(createPluginToast(toast))
bindPluginUiTransport({
  request: (path, init) => apiFetch(`${API_BASE_URL}${path}`, init),
  url: (path) => `${API_BASE_URL}${path}`,
})

/**
 * The workspace snapshot, CACHED by identity.
 *
 * `useSyncExternalStore` compares snapshots by reference and re-renders until two consecutive reads
 * match. This built a fresh object literal every call, so the moment anything subscribed through a
 * hook the comparison never settled and React aborted the render — the whole route fell to its
 * error boundary. Nothing subscribed before `usePluginWorkspace` existed, which is why an unstable
 * snapshot sat here harmlessly.
 *
 * Rebuilt only when one of its inputs actually changes; `items` is already a stable reference from
 * the store, so the check is two comparisons, not a deep equality. The grid's focused scope is not
 * in it: a plugin acts for the chat it belongs to, never for the one on screen.
 */
let cachedSnapshot: PluginWorkspaceSnapshot | null = null
function workspaceSnapshot(): PluginWorkspaceSnapshot {
  const state = useGridStore.getState()
  const focusedId = focusedVisibleTabId(state)
  if (
    !cachedSnapshot ||
    cachedSnapshot.items !== state.items ||
    cachedSnapshot.focusedId !== focusedId
  ) {
    cachedSnapshot = { items: state.items, focusedId }
  }
  return cachedSnapshot
}

bindPluginUiRuntime({
  workspace: {
    openWorkItem: (request) => {
      assertPluginOwnedWorkItemInstance(request)
      inspector.openWorkItem(request)
    },
    // The native "jump to source" door: any plugin can open a file in the code editor at an exact
    // line/column, the same way core's own diagnostics and search results do — in the chat the
    // request names.
    openFile: (request) =>
      openFileInGrid({
        sessionId: request.sessionId,
        path: request.path,
        line: request.line,
        column: request.column,
        endLine: request.endLine,
        endColumn: request.endColumn,
        ...(request.openWith ? { openWith: request.openWith } : {}),
      }),
    // The diff door beside `openFile`. `provenance` / `staging` arrive opaque from the plugin and
    // are handed to the slots that own them, so the seam never learns a source-control vocabulary.
    openDiff: ({ provenance, staging, ...rest }) =>
      inspector.openDiff({
        ...rest,
        // Opaque across the seam by design (see `PluginOpenDiffRequest`); the host is the side
        // that knows which slot renders each, so the narrowing happens here and nowhere else.
        ...(provenance ? { provenance: provenance as DiffProvenanceRequest } : {}),
        ...(staging ? { staging: staging as OpenDiffRequest['staging'] } : {}),
      }),
    // The preview door beside `openFile`: the core auto-serves the directory and attaches the
    // panel through the injecting proxy, in the chat the request names. The reveal happens from the
    // RESPONSE, not the `preview.updated` frame — `revealPreview` records why the frame alone
    // reached nobody, and owns the shared version guard.
    openPreview: async ({ path, sessionId, root, title }) => {
      const opened = await backendClient.openPreview(sessionId, path, root)
      revealPreview(sessionId, { ...opened, title: title ?? opened.title })
    },
    closeWorkItems: (prefix, options) => inspector.closeWorkItems(prefix, options),
    focusWorkItem: (id) => inspector.focusWorkItem(id),
    openSidebarSection,
    getSnapshot: () => workspaceSnapshot(),
    subscribe: (listener) => useGridStore.subscribe(listener),
  },
  composer: { insert: (request) => composerBus.insert(request) },
  terminal: {
    openPanel: (sessionId) => inspector.openTerminal(sessionId),
    // The paste-don't-execute door, into the named chat's terminal. `terminalBus.run` already strips
    // a trailing newline centrally, so a plugin cannot accidentally execute on the person's behalf.
    paste: (request) => terminalBus.run(request),
    openJob: (request) => terminal.openJob(request),
    spawnCommand: async (request) => {
      const result = await backendClient.spawnTerminalCommand({
        command: request.command,
        // The session is what gives the PTY a project directory. Dropping it here ran every
        // plugin-spawned command — a `docker exec`, a `kubectl exec`, an agent CLI — in whatever
        // directory the API process happened to start in.
        sessionId: request.sessionId,
      })
      terminal.openJob({
        terminalId: result.terminalId,
        sessionId: request.sessionId,
        title: request.title,
      })
      return result
    },
  },
  files: createPluginFilesRuntime(),
  secrets: {
    listReferences: async () =>
      (await secretsApi.list())
        .filter((secret) => secret.reference !== null)
        .map((secret) => ({
          key: secret.key,
          label: secret.label || secret.key,
          reference: secret.reference!,
        })),
    set: async (request) => {
      await secretsApi.set(request)
    },
  },
  realtime: {
    onFrame: (tag, handler) => eventSocket.onFrame(tag, handler),
    onReconnect: (handler) => eventSocket.onReconnect(handler),
    onDisconnect: (handler) => eventSocket.onDisconnect(handler),
    request: (payload, options) => eventSocket.request(payload, options),
  },
  sessions: {
    list: () => useChatStore.getState().allSessions,
    subscribe: (listener) => useChatStore.subscribe(listener),
    stop: async (sessionId) => {
      await backendClient.stop(sessionId)
    },
    interact: async (requestId, action, payload) => {
      await backendClient.interact(requestId, action, payload)
    },
    importConversation: async (input) => {
      const session = await backendClient.importSession(input)
      return { id: session.id, projectId: session.projectId }
    },
    openTranscript,
  },
  navigation: {
    revealSession: (sessionId, projectId) => {
      if (revealJobSession(sessionId)) return
      const segments = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
      const projectIndex = segments[0] === 'project' ? 1 : -1
      const currentProject = projectIndex >= 0 ? (segments[projectIndex] ?? null) : null
      const targetProject =
        projectId ??
        useChatStore.getState().allSessions.find((session) => session.id === sessionId)?.projectId
      const possibleSection = segments[segments[0] === 'project' ? 3 : 2]
      const section = isSectionId(possibleSection) ? possibleSection : null
      // A session the store has never seen and a caller that named no project leave nothing
      // to address: keep the current scope rather than inventing a project-less one.
      const scope = resolveNavScope(targetProject, currentProject)
      if (scope) window.location.hash = scopePath(scope, sessionId, section)
    },
    openBinding: (binding, sessionId) => {
      // A link that names its own conversation (a tool call dragged out of a transcript) opens
      // there; otherwise in the caller's chat. With neither, nothing session-bound opens.
      const own = binding.target.attributes?.sessionId
      const target = (typeof own === 'string' && own) || sessionId
      const mediaId = binding.target.attributes?.mediaId
      if (binding.target.kind === 'file' && typeof mediaId === 'string' && mediaId) {
        if (!target) return false
        const name = binding.target.attributes?.name
        inspector.openMediaFile({
          sessionId: target,
          mediaId,
          name: typeof name === 'string' ? name : binding.target.label,
        })
        return true
      }
      const ref = refFromContextBinding(binding)
      const action = refOpenAction(ref, {
        sessionId: target,
        navigate: (path) => {
          window.location.hash = path
        },
      })
      action?.()
      return action !== null
    },
  },
  resources: {
    browse: async (partial, sessionId) => {
      const result = await backendClient.browseResources(partial, sessionId ?? undefined)
      return {
        parent: result.parent,
        nodes: result.groups.flatMap((group) => group.resources),
        notices: result.notices,
        total: result.total,
        truncated: result.truncated,
      }
    },
  },
  projects: {
    resolvePath: async (path) => {
      const result = await projectsApi.resolveProjectByPath(path)
      return { id: result.project.id }
    },
    refresh: () => useChatStore.getState().loadProjects(),
  },
  editor: {
    predictionEnabled: () =>
      isModelRoutingTaskEnabled(
        useSettingsStore.getState().settings.agentSettings,
        'inlineCompletion',
      ),
    subscribe: (listener) => useSettingsStore.subscribe(listener),
    // Every plugin editor carries what is open on screen, not only the anchors it passes itself.
    predictNextEdit: (sessionId, request, signal) =>
      backendClient.predictNextEdit(
        sessionId,
        {
          ...request,
          contextReferences: [
            ...(request.contextReferences ?? []).map((reference) => ({
              ...reference,
              origin: reference.origin ?? ('linked' as const),
            })),
            ...completionWorkingSet({ excludeFilePath: request.file }),
          ],
        },
        signal,
      ),
  },
  // The host's own lifecycle, not a copy: a plugin field and the chat composer share one hub,
  // one model call per idle moment, one cache and the same working set.
  completion: {
    useTextInput: useInlineCompletion,
  },
  clipboard: {
    writeText: (text) => platformCapabilities().clipboard.writeText(text),
  },
  external: {
    open: (url, systemBrowser) => platformCapabilities().external.open(url, systemBrowser),
  },
})
