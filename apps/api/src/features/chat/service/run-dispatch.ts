/**
 * Shared `.catch` handler for the fire-and-forget `runner.run(...)` dispatches
 * scattered across the service (agent run, macro run, regenerate, edit). Each
 * site started a run without awaiting it and logged a start failure the same
 * way; this keeps the log shape ("[chat-service] failed to start <label> run")
 * consistent in one place.
 */
export function logRunStartFailure(label: string, sessionId: string): (error: unknown) => void {
  return (error: unknown) => {
    console.error(`[chat-service] failed to start ${label} run`, sessionId, error)
  }
}
