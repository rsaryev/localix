/** The most output kept from one child, from its end: the end is where the failure is. */
const MAX_OUTPUT = 64 * 1024

function bounded() {
  let text = ''
  let dropped = false
  return {
    append(chunk: string) {
      text += chunk
      if (text.length > MAX_OUTPUT * 2) {
        text = text.slice(-MAX_OUTPUT)
        dropped = true
      }
    },
    text: () => (dropped ? `[earlier output dropped]\n${text.slice(-MAX_OUTPUT)}` : text),
  }
}

/**
 * Run Bun (the one running this toolchain) on a mini app, bounded in time and output. The type
 * checker and the app's tests run this way: the checker is synchronous and a test run executes the
 * app's code, and neither may stall the command that started them.
 */
export async function runBun(
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; output: string }> {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
    windowsHide: true,
  })
  const timeout = setTimeout(() => child.kill(), timeoutMs)
  const stdout = bounded()
  const both = bounded()
  const drain = async (stream: ReadableStream<Uint8Array>, into: (text: string) => void) => {
    const decoder = new TextDecoder()
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      into(decoder.decode(value, { stream: true }))
    }
  }
  try {
    await Promise.all([
      drain(child.stdout, (text) => {
        stdout.append(text)
        both.append(text)
      }),
      drain(child.stderr, (text) => both.append(text)),
    ])
    return { code: await child.exited, stdout: stdout.text(), output: both.text() }
  } finally {
    clearTimeout(timeout)
  }
}
