import { describe, expect, test } from 'bun:test'
import { ApiExecRegistry, buildPodShellCommand, buildRelayCommand, type ExecDeps } from './api-exec'

describe('pod exec relay', () => {
  test('runs the running runtime, never a bare `bun` the packaged app does not put on PATH', () => {
    const command = buildRelayCommand('ws://127.0.0.1:1/t', "/Apps/Local ix/bun's")
    expect(command.startsWith(`'/Apps/Local ix/bun'\\''s' -e `)).toBe(true)
    expect(buildRelayCommand('ws://x')).toStartWith(`'${process.execPath}' -e `)
    expect(buildRelayCommand('ws://x')).not.toMatch(/^bun /)
  })

  test('a terminal that closes during setup closes the remote it was about to get', async () => {
    let resolveRemote!: (remote: { close(): void; addEventListener(): void }) => void
    let closed = 0
    let connectStarted!: () => void
    const started = new Promise<void>((resolve) => (connectStarted = resolve))
    const deps: ExecDeps = {
      verifyPod: async () => {},
      connect: () => {
        connectStarted()
        return new Promise((resolve) => (resolveRemote = resolve))
      },
    }
    const registry = new ApiExecRegistry(deps)
    const command = await registry.command({ namespace: 'default', pod: 'p' })
    const url = command.match(/'(ws:\/\/[^']+)'$/)![1]!
    const socket = new WebSocket(url)
    await started
    const socketClosed = new Promise((resolve) => socket.addEventListener('close', resolve))
    socket.close()
    await socketClosed
    // Give the server its close callback before the cluster answers.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
    resolveRemote({ close: () => void closed++, addEventListener: () => {} })
    await new Promise((r) => setTimeout(r, 0))
    expect(closed).toBe(1)
    await registry.stopAll()
  })
})

describe('pod exec shell profile', () => {
  test('adds a temporary 256-color Kubernetes prompt with a minimal-shell fallback', () => {
    const command = buildPodShellCommand({
      context: 'k3d-localix',
      namespace: 'default',
      pod: 'nginx-test',
      container: 'nginx',
    })

    expect(command).toContain('TERM="${TERM:-xterm-256color}"')
    expect(command).toContain('COLORTERM="${COLORTERM:-truecolor}"')
    expect(command).toContain('k3d-localix · default/nginx-test · nginx')
    expect(command).toContain('exec bash --noprofile --norc -i')
    expect(command).toContain('exec sh -i')
    expect(command).toContain('⎈')
  })

  test('keeps unexpected identity characters out of the generated shell program', () => {
    const command = buildPodShellCommand({
      namespace: 'default; touch /tmp/nope',
      pod: "api$(printf 'bad')",
    })

    expect(command).not.toContain('touch /tmp/nope')
    expect(command).not.toContain("$(printf 'bad')")
  })
})
