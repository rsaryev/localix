import type { TerminalToolDeps } from './terminal'
import { encodeKeys } from './terminal-keys'

/** Separate input bursts so text + Enter is not mistaken for pasted multiline text. */
function pause(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, 50)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export async function sendTerminalInput(
  deps: TerminalToolDeps,
  terminalId: string,
  input: { text?: string; keys?: string[] },
  signal?: AbortSignal,
): Promise<'sent' | 'exited' | 'interrupted'> {
  let sent = false
  const write = async (data: string) => {
    if (sent) await pause(signal)
    if (signal?.aborted) return 'interrupted' as const
    if (!deps.write(terminalId, data)) return 'exited' as const
    sent = true
    return 'sent' as const
  }
  if (input.text !== undefined) {
    const result = await write(input.text)
    if (result !== 'sent') return result
  }
  for (const key of input.keys ?? []) {
    if (signal?.aborted) return 'interrupted'
    // Programs such as vim switch arrow keys into application (SS3) mode.
    let encoded = encodeKeys([key])
    if (encoded.length === 3 && encoded.startsWith('\x1b[') && 'ABCDHF'.includes(encoded[2])) {
      const screen = await deps.screen(terminalId)
      encoded = encodeKeys([key], screen?.applicationCursorKeys)
    }
    const result = await write(encoded)
    if (result !== 'sent') return result
  }
  return 'sent'
}
