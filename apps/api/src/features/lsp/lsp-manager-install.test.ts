import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import * as binaries from './lsp-bin-resolve'
import type { LspClientInfo } from './lsp-client'
import type { LspInstallOutcome, LspInstaller } from './lsp-installer'
import { createLspManager } from './lsp-manager'
import type { LspServerState } from './lsp-manager-types'

const root = '/fixture-go'
const file = `${root}/main.go`
const installedDir = '/managed/gopls/v0.24.0'

let spawned: string[] = []
const spies: { mockRestore(): void }[] = []
beforeEach(() => {
  spawned = []
  // Nothing on PATH: the Go server has to come from a managed install.
  spies.push(spyOn(binaries, 'which').mockImplementation(() => undefined))
  spies.push(
    spyOn(binaries, 'spawnServer').mockImplementation((cmd) => {
      spawned.push(cmd)
      return {} as ChildProcessWithoutNullStreams
    }),
  )
})
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

/** An installer that answers `outcome` when released, recording each request. */
function installerStub(outcome: LspInstallOutcome, dir = installedDir) {
  let release!: () => void
  let gate = new Promise<void>((resolve) => (release = resolve))
  let done = false
  const requests: string[] = []
  const installer: LspInstaller = {
    installedDir: () => (done && outcome.ok ? dir : undefined),
    async install(id, onProgress) {
      requests.push(id)
      onProgress?.(0.5)
      await gate
      done = true
      return outcome
    },
  }
  return {
    installer,
    requests,
    release: () => release(),
    reset() {
      gate = new Promise<void>((resolve) => (release = resolve))
    },
  }
}

function clientStub() {
  const synced: [string, string][] = []
  const client = {
    syncDocument: async (path: string, content: string) => {
      synced.push([path, content])
    },
    hover: async () => ({ value: 'func main()' }),
    diagnostics: () => ({}),
    hasOpenDocuments: () => true,
    dispose: () => {},
  } as unknown as LspClientInfo
  return { client, synced }
}

const statusOf = (states: LspServerState[]) =>
  states.map(({ serverId, status, progress, unavailable }) => ({
    serverId,
    status,
    ...(progress !== undefined ? { progress } : {}),
    ...(unavailable ? { unavailable } : {}),
  }))

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

test('opening a .go file with no gopls installs it once, starts it, and opens the buffer', async () => {
  const stub = installerStub({ ok: true, dir: installedDir })
  const { client, synced } = clientStub()
  const manager = createLspManager({
    idleTimeoutMs: 0,
    installer: stub.installer,
    createClient: async (input) => {
      input.onReady?.()
      return client
    },
  })
  const seen: unknown[] = []
  manager.onUpdate((_root, states) => seen.push(statusOf(states)))
  try {
    await manager.openDocument(root, file, 'package main')
    await manager.openDocument(root, `${root}/util.go`, 'package main // util')
    // Asked while installing: answers at once with nothing, instead of waiting on the download.
    expect(await manager.hover(root, file, { line: 0, character: 0 })).toBeNull()
    expect(stub.requests).toEqual(['gopls'])
    expect(statusOf(manager.getServerStates(root))).toEqual([
      { serverId: 'go', status: 'installing', progress: 0.5 },
    ])

    stub.release()
    await settle()

    expect(spawned).toEqual([`${installedDir}/bin/gopls`])
    expect(statusOf(manager.getServerStates(root))).toEqual([{ serverId: 'go', status: 'ready' }])
    // The buffers opened during the install reach the server once it is ready.
    expect(synced).toEqual([
      [file, 'package main'],
      [`${root}/util.go`, 'package main // util'],
    ])
    expect(await manager.hover(root, file, { line: 0, character: 0 })).toEqual({
      value: 'func main()',
    })
    expect(seen.map((states) => (states as { status: string }[]).map((s) => s.status))).toEqual([
      ['installing'],
      ['installing'],
      ['starting'],
      ['ready'],
      ['ready'],
    ])
  } finally {
    manager.dispose()
  }
})

for (const [reason, detail] of [
  ['failed', 'gopls failed its checksum'],
  ['offline', 'Could not reach proxy.golang.org'],
  ['needs-toolchain', 'Go'],
] as const) {
  test(`a ${reason} install shows why, starts nothing, and is tried again later`, async () => {
    let now = 1_000
    const stub = installerStub({ ok: false, reason, detail })
    const manager = createLspManager({
      idleTimeoutMs: 0,
      installer: stub.installer,
      now: () => now,
      createClient: async () => {
        throw new Error('no server should start')
      },
    })
    try {
      await manager.openDocument(root, file, 'package main')
      stub.release()
      await settle()
      expect(statusOf(manager.getServerStates(root))).toEqual([
        { serverId: 'go', status: 'unavailable', unavailable: { reason, detail } },
      ])
      expect(spawned).toEqual([])

      // Editing again right away does not hammer the installer…
      await manager.changeDocument(root, file, 'package main\n')
      expect(stub.requests).toEqual(['gopls'])

      // …but once the cooldown has passed, the next open tries again.
      stub.reset()
      now += 10 * 60_000
      await manager.changeDocument(root, file, 'package main\n\n')
      expect(stub.requests).toEqual(['gopls', 'gopls'])
      stub.release()
      await settle()
    } finally {
      manager.dispose()
    }
  })
}

test('a status listener that throws while an install settles is contained, and the entry is not left installing', async () => {
  const stub = installerStub({ ok: false, reason: 'offline', detail: 'no network' })
  const manager = createLspManager({
    idleTimeoutMs: 0,
    installer: stub.installer,
    createClient: async () => {
      throw new Error('no server should start')
    },
  })
  const escaped: unknown[] = []
  const onEscape = (reason: unknown) => escaped.push(reason)
  process.on('unhandledRejection', onEscape)
  try {
    manager.onUpdate((_root, states) => {
      if (states.some((state) => state.status === 'unavailable')) throw new Error('listener broke')
    })
    await manager.openDocument(root, file, 'package main')
    stub.release()
    await settle()
    // Unhandled rejections surface on a later turn.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(escaped).toEqual([])
    expect(statusOf(manager.getServerStates(root))[0]?.status).toBe('unavailable')
  } finally {
    process.off('unhandledRejection', onEscape)
    manager.dispose()
  }
})

const rustRoot = '/fixture-rs'
const rustFile = `${rustRoot}/src/main.rs`
// rustup puts this proxy on PATH even when no toolchain has the rust-analyzer component.
const rustupShim = '/home/.cargo/bin/rust-analyzer'

test('opening a .rs file whose PATH rust-analyzer cannot run installs the managed one and starts it', async () => {
  spies.push(
    spyOn(binaries, 'which').mockImplementation((cmd) =>
      cmd === 'rust-analyzer' ? rustupShim : undefined,
    ),
  )
  // It exits at once with "Unknown binary 'rust-analyzer' in official toolchain".
  spies.push(spyOn(binaries, 'answersVersion').mockImplementation(async () => false))
  const dir = '/managed/rust-analyzer/2026-10-19'
  const stub = installerStub({ ok: true, dir }, dir)
  const { client } = clientStub()
  const manager = createLspManager({
    idleTimeoutMs: 0,
    installer: stub.installer,
    createClient: async (input) => {
      input.onReady?.()
      return client
    },
  })
  try {
    await manager.openDocument(rustRoot, rustFile, 'fn main() {}')
    expect(stub.requests).toEqual(['rust-analyzer'])
    stub.release()
    await settle()
    expect(spawned).toEqual([`${dir}/rust-analyzer`])
    expect(statusOf(manager.getServerStates(rustRoot))).toEqual([
      { serverId: 'rust', status: 'ready' },
    ])
  } finally {
    manager.dispose()
  }
})

test('a rust-analyzer on PATH that runs is the one started, with nothing installed', async () => {
  const probed: [string, string][] = []
  spies.push(
    spyOn(binaries, 'which').mockImplementation((cmd) =>
      cmd === 'rust-analyzer' ? rustupShim : undefined,
    ),
    spyOn(binaries, 'answersVersion').mockImplementation(async (bin, cwd) => {
      probed.push([bin, cwd])
      return true
    }),
  )
  const stub = installerStub({ ok: true, dir: '/unused' })
  const { client } = clientStub()
  const manager = createLspManager({
    idleTimeoutMs: 0,
    installer: stub.installer,
    createClient: async (input) => {
      input.onReady?.()
      return client
    },
  })
  try {
    await manager.openDocument(rustRoot, rustFile, 'fn main() {}')
    await settle()
    // Asked from the crate's root, where a rust-toolchain.toml picks the toolchain.
    expect(probed).toEqual([[rustupShim, rustRoot]])
    expect(spawned).toEqual([rustupShim])
    expect(stub.requests).toEqual([])
  } finally {
    manager.dispose()
  }
})
