export interface TerminalLifecycleMarker {
  kind: 'waiting' | 'input' | 'finished'
  terminalId: string
  active?: boolean
  label?: string
}

export interface TerminalLifecycleMessage {
  terminalLifecycle?: TerminalLifecycleMarker
}

export interface ActiveTerminalWait {
  terminalId: string
  label?: string
}

/**
 * Pick the most recently rendered active terminal wait. A client keeps
 * a single status phase while the transcript may contain several concurrent
 * PTY waits, so settling one terminal must fall back to the next live wait.
 */
export function latestActiveTerminalWait(
  messages: readonly TerminalLifecycleMessage[],
): ActiveTerminalWait | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const marker = messages[index]?.terminalLifecycle
    if (marker?.kind === 'waiting' && marker.active) {
      return { terminalId: marker.terminalId, label: marker.label }
    }
  }
  return null
}
