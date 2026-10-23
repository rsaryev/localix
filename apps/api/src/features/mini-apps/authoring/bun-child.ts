import { createBoundedOutput } from '../../agent-core/tools/bash/bash-output'

/**
 * Run the app's own Bun (`process.execPath` — the binary the app ships, on every platform) on a
 * user plugin, bounded in time and output. The plugin checks run their tools this way rather than
 * in the API process: the type checker is synchronous and a test run executes plugin code, and
 * neither may stall or crash the process every session depends on.
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
  const stdout = createBoundedOutput()
  const both = createBoundedOutput()
  const drain = async (stream: ReadableStream<Uint8Array>, into: (text: string) => void) => {
    // A reader loop, not `for await`: the build's DOM lib types a ReadableStream without an
    // async iterator.
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
