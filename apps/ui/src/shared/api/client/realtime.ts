import { eventSocket } from '../eventSocket'

/** Requests that ride the shared realtime WebSocket (HITL, secrets, command replies). */
export const realtimeApi = {
  // HITL responses / tool kills over the shared realtime WebSocket (see eventSocket).
  async interact(toolCallId: string, action: string, payload?: unknown): Promise<void> {
    await eventSocket.request<{ ok: true }>({ t: 'interact', toolCallId, action, payload })
  },

  // The request_secret VALUE side-channel: a dedicated `submit-secret` frame,
  // deliberately NOT `interact` — the plaintext goes straight to the server's
  // encrypted vault and never touches the ask/quiz respond path (whose payloads
  // land in the HITL controller's answer record). The reply is `{ok}` only.
  async submitSecret(requestId: string, value: string): Promise<void> {
    await eventSocket.request<{ ok: true }>({ t: 'submit-secret', requestId, value })
  },

  // Revoke a session's "Always allow" grant (drop one tool, or all when toolName is
  // omitted) so it re-prompts on its next call. The server publishes
  // session_permissions.updated, so the chip refreshes from the firehose.
  async revokeSessionPermission(sessionId: string, toolName?: string): Promise<string[]> {
    const res = await eventSocket.request<{ autoApprovedTools: string[] }>({
      t: 'session.revoke-permission',
      sessionId,
      ...(toolName ? { toolName } : {}),
    })
    return res.autoApprovedTools ?? []
  },

  // Reply to an agent `browser` tool command after the open preview's probe ran
  // it — settles the server-side pending promise (preview-command-registry).
  async previewResult(commandId: string, payload: Record<string, unknown>): Promise<boolean> {
    const result = await eventSocket.request<{ resolved: boolean }>({
      t: 'preview-result',
      commandId,
      ...payload,
    })
    return result.resolved
  },

  // Reply to an awaited `plugin.command` frame after the plugin's UI sink handled
  // it — settles the server-side pending promise (plugin-command-registry).
  async miniAppCommandResult(
    commandId: string,
    payload: { ok: boolean; result?: unknown; error?: string },
  ): Promise<void> {
    await eventSocket.request<{ resolved: boolean }>({
      t: 'plugin-command-result',
      commandId,
      ...payload,
    })
  },
}
