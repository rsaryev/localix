import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createLspClient } from './lsp-client'
import type { LspClientInfo } from './lsp-protocol'

/**
 * Protocol-level coverage for what the editor sync actually puts on the wire.
 * Everything else in this feature is tested against normalizers and lifecycle
 * state; nothing observed the notification SEQUENCE, which is where a wrong
 * notification hides — a language server accepts it silently and just does more
 * work, or the wrong work.
 *
 * The harness is a minimal LSP server over stdio that answers `initialize` and
 * appends every notification method it receives to a log file.
 */

const FAKE_SERVER = `
const log = process.argv[2]
const fs = require('node:fs')
let buf = Buffer.alloc(0)
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  process.stdout.write(\`Content-Length: \${body.length}\\r\\n\\r\\n\`)
  process.stdout.write(body)
}
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const header = buf.indexOf('\\r\\n\\r\\n')
    if (header < 0) return
    const len = Number(/Content-Length: (\\d+)/.exec(buf.subarray(0, header).toString())?.[1])
    if (!Number.isFinite(len) || buf.length < header + 4 + len) return
    const msg = JSON.parse(buf.subarray(header + 4, header + 4 + len).toString())
    buf = buf.subarray(header + 4 + len)
    // A code action also logs its context.triggerKind — the one param whose absence
    // changes what the server does (see CodeActionTrigger).
    const trigger =
      msg.method === 'textDocument/codeAction' ? ' ' + msg.params.context.triggerKind : ''
    if (msg.method) fs.appendFileSync(log, msg.method + ' ' + len + trigger + '\\n')
    // Publish (empty) diagnostics for any buffer push, so the write path's
    // wait-for-diagnostics resolves instead of sitting out its 6s timeout.
    if (msg.method === 'textDocument/didOpen' || msg.method === 'textDocument/didChange') {
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: msg.params.textDocument.uri, diagnostics: [] },
      })
    }
    if (msg.id !== undefined) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result:
          msg.method === 'initialize'
            ? {
              capabilities: {
                codeActionProvider: true,
                textDocumentSync:
                  process.argv[3] === 'save-include-text'
                    ? { change: 1, save: { includeText: true } }
                    : process.argv[3] === 'incremental'
                      ? { change: 2 }
                      : 1,
              },
            }
            : msg.method === 'workspace/diagnostic'
              ? { items: [] }
              : msg.method === 'textDocument/diagnostic'
                ? { kind: 'full', items: [] }
                : null,
      })
    }
    // After initialize, optionally register WORKSPACE diagnostics dynamically —
    // the capability that makes the client issue \`workspace/diagnostic\`.
    if (msg.method === 'initialize' && process.argv[3] === 'workspace-diagnostics') {
      send({
        jsonrpc: '2.0',
        id: 9001,
        method: 'client/registerCapability',
        params: {
          registrations: [
            {
              id: 'wd-1',
              method: 'textDocument/diagnostic',
              registerOptions: { workspaceDiagnostics: true, interFileDependencies: true },
            },
            {
              id: 'dd-1',
              method: 'textDocument/diagnostic',
              registerOptions: { workspaceDiagnostics: false, interFileDependencies: false },
            },
          ],
        },
      })
    }
  }
})
`

let dir: string
let logFile: string
let proc: ChildProcessWithoutNullStreams | undefined
let client: LspClientInfo | undefined

/**
 * Notification methods the server has received, in order. Notifications are
 * fire-and-forget — `sendNotification` resolves when the bytes hit the pipe, not
 * when the far side has handled them — so wait for the log to stop growing rather
 * than reading it once and racing the server.
 */
async function methods(): Promise<string[]> {
  return (await frames()).map((f) => f.method)
}

/** Every logged frame as `{ method, bytes }`, once the log has stopped growing. */
async function frames(): Promise<{ method: string; bytes: number }[]> {
  const read = async () =>
    (await Bun.file(logFile).text())
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [method = '', size = '0'] = line.split(' ')
        return { method, bytes: Number(size) }
      })
  let previous = await read()
  for (let stable = 0; stable < 3;) {
    await new Promise((r) => setTimeout(r, 25))
    const next = await read()
    stable = next.length === previous.length ? stable + 1 : 0
    previous = next
  }
  return previous
}

/** Total wire bytes the server received for one notification method. */
const bytesFor = (all: { method: string; bytes: number }[], method: string) =>
  all.filter((f) => f.method === method).reduce((sum, f) => sum + f.bytes, 0)

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lsp-proto-'))
  logFile = path.join(dir, 'methods.log')
  writeFileSync(logFile, '')
  const server = path.join(dir, 'fake-server.cjs')
  writeFileSync(server, FAKE_SERVER)
  proc = spawn('bun', [server, logFile], { stdio: ['pipe', 'pipe', 'pipe'] })
})

/** Respawn the fake in a given mode (dynamic registrations / save options). */
function respawnFake(mode: 'workspace-diagnostics' | 'save-include-text' | 'incremental') {
  proc?.kill('SIGKILL')
  proc = spawn('bun', [path.join(dir, 'fake-server.cjs'), logFile, mode], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

afterEach(() => {
  client?.dispose?.()
  proc?.kill('SIGKILL')
  rmSync(dir, { recursive: true, force: true })
})

async function connect(): Promise<LspClientInfo> {
  const info = await createLspClient({ serverId: 'fake', process: proc!, rootDir: dir })
  if (!info) throw new Error('client did not initialize')
  client = info
  return info
}

describe('editor buffer sync — what reaches the server', () => {
  test('opens once, then only changes; a keystroke is not reported as a disk event', async () => {
    const lsp = await connect()
    const file = path.join(dir, 'a.ts')
    writeFileSync(file, 'const a = 1')

    await lsp.syncDocument(file, 'const a = 1')
    await lsp.syncDocument(file, 'const a = 12')
    await lsp.syncDocument(file, 'const a = 123')

    const seen = await methods()
    expect(seen.filter((m) => m === 'textDocument/didOpen').length).toBe(1)
    expect(seen.filter((m) => m === 'textDocument/didChange').length).toBe(2)

    // `workspace/didChangeWatchedFiles` means "the FILE SYSTEM changed" — the spec
    // defines it as sent "when the client detects changes to file watched by the
    // language client". An editor keystroke is not that: the buffer moved, the file
    // on disk did not. Announcing it tells the server to invalidate and re-read the
    // path from disk, where it finds the STALE unsaved content, on every sync.
    expect(seen.filter((m) => m === 'workspace/didChangeWatchedFiles')).toEqual([])
  })

  test('a real disk change IS announced to the watcher', async () => {
    const lsp = await connect()
    const file = path.join(dir, 'written.ts')
    writeFileSync(file, 'export const written = 1')

    // `touchFileAndWait` is the agent-write path: the content is read back FROM
    // DISK precisely because it changed there. Here the notification is correct,
    // and gating it on the editor path must not have silenced this one too.
    await lsp.touchFileAndWait(file)

    const seen = await methods()
    expect(seen.filter((m) => m === 'workspace/didChangeWatchedFiles').length).toBe(1)
    expect(seen).toContain('textDocument/didOpen')
  })

  test('an editor buffer never announces a watcher event, however many syncs', async () => {
    const lsp = await connect()
    const file = path.join(dir, 'new.ts')
    writeFileSync(file, 'export {}')

    await lsp.syncDocument(file, 'export {}')
    for (let i = 0; i < 5; i++) await lsp.syncDocument(file, `export const x = ${i}`)

    const seen = await methods()
    expect(seen.filter((m) => m === 'workspace/didChangeWatchedFiles')).toEqual([])
    // The document still reaches the server — by the mechanism meant for buffers.
    expect(seen.filter((m) => m === 'textDocument/didOpen').length).toBe(1)
    expect(seen.filter((m) => m === 'textDocument/didChange').length).toBe(5)
  })
})

// Only the agent's own writes ever reached the server as watcher events, so a terminal edit or
// a branch switch left it answering from files that had changed under it.
describe('external disk changes (the workspace watcher)', () => {
  test('a change nobody synced is announced as didChangeWatchedFiles', async () => {
    const lsp = await connect()
    await lsp.notifyWatchedFiles([
      { path: path.join(dir, 'created-in-terminal.ts'), type: 'create' },
      { path: path.join(dir, 'gone.ts'), type: 'delete' },
    ])
    const seen = await methods()
    expect(seen.filter((m) => m === 'workspace/didChangeWatchedFiles').length).toBe(1)
  })

  // An open document's truth is its editor buffer; a watcher event for it would make the
  // server re-read a disk copy that may lack the unsaved edit.
  test('a file the editor holds open is left out', async () => {
    const lsp = await connect()
    const file = path.join(dir, 'open.ts')
    writeFileSync(file, 'export {}')
    await lsp.syncDocument(file, 'export const unsaved = 1')
    await lsp.notifyWatchedFiles([{ path: file, type: 'update' }])
    const seen = await methods()
    expect(seen.filter((m) => m === 'workspace/didChangeWatchedFiles')).toEqual([])
  })
})

describe('diagnostics pull fan-out', () => {
  test('one workspace-wide report serves every file that asked for it', async () => {
    respawnFake('workspace-diagnostics')
    const lsp = await connect()
    const files = ['x.ts', 'y.ts', 'z.ts'].map((n) => path.join(dir, n))
    for (const f of files) writeFileSync(f, 'export {}')
    // Let the dynamic registration land before the first pull.
    await new Promise((r) => setTimeout(r, 50))

    await Promise.all(files.map((f) => lsp.syncDocument(f, 'export {}')))

    const seen = await methods()
    // `workspace/diagnostic` takes no file path — its answer covers the whole
    // project and is identical whichever document triggered it. Issuing one per
    // open document makes the server run a whole-project analysis N times to
    // produce N copies of the same report.
    expect(seen.filter((m) => m === 'workspace/diagnostic').length).toBe(1)
    // The per-document pull is genuinely per-document and must still happen once each.
    expect(seen.filter((m) => m === 'textDocument/diagnostic').length).toBe(3)
  })
})

describe('code action trigger', () => {
  test('the lightbulb probe is AUTOMATIC; an explicit request (and the default) is INVOKED', async () => {
    const lsp = await connect()
    const file = path.join(dir, 'fix.ts')
    writeFileSync(file, 'export {}')
    await lsp.syncDocument(file, 'export {}')
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

    await lsp.codeAction(file, range, [], ['quickfix'], 'automatic')
    await lsp.codeAction(file, range, [], ['quickfix'], 'invoked')
    await lsp.codeAction(file, range, [], ['quickfix'])

    await methods()
    const triggers = (await Bun.file(logFile).text())
      .split('\n')
      .filter((line) => line.startsWith('textDocument/codeAction '))
      .map((line) => line.split(' ')[2])
    // vtsls cancels and restarts its running error check for an INVOKED request, and treats
    // an absent triggerKind as invoked — so the per-caret-move probe must say automatic.
    expect(triggers).toEqual(['2', '1', '1'])
  })
})

describe('didSave payload', () => {
  test('an editor buffer sync is not a save — no didSave per keystroke', async () => {
    const lsp = await connect()
    const file = path.join(dir, 'typing.ts')
    writeFileSync(file, 'export {}')

    for (let i = 0; i < 4; i++) await lsp.syncDocument(file, `export const x = ${i}`)

    // Check-on-save servers (rust-analyzer's `cargo check`) started a full check on every
    // announced save — and every pause in typing used to announce one.
    expect((await methods()).filter((m) => m === 'textDocument/didSave')).toEqual([])
    await lsp.saveDocument(file)
    expect((await methods()).filter((m) => m === 'textDocument/didSave').length).toBe(1)
  })

  test('does not re-ship the whole document when the server never asked for it', async () => {
    const lsp = await connect()
    const file = path.join(dir, 'big.ts')
    const body = `export const blob = '${'x'.repeat(100_000)}'`
    writeFileSync(file, body)

    await lsp.syncDocument(file, body)
    await lsp.syncDocument(file, body + '\n')
    await lsp.saveDocument(file)
    await lsp.saveDocument(file)

    const all = await frames()
    // didChange legitimately carries the buffer.
    expect(bytesFor(all, 'textDocument/didChange')).toBeGreaterThan(100_000)
    // didSave's `text` is spec'd as present only when the server requested it via
    // `save.includeText` (LSP DidSaveTextDocumentParams: "Depends on the includeText
    // value when the save notification was requested"). This fake declares no save
    // options at all, so a body here is bytes the server is entitled to discard —
    // and it doubles what every 150ms editor sync puts on the wire.
    expect(bytesFor(all, 'textDocument/didSave')).toBeLessThan(2_000)
  })

  test('a server that DID ask for the body on save still gets it', async () => {
    respawnFake('save-include-text')
    const lsp = await connect()
    const file = path.join(dir, 'big.ts')
    const body = `export const blob = '${'y'.repeat(100_000)}'`
    writeFileSync(file, body)

    await lsp.syncDocument(file, body)
    await lsp.saveDocument(file)

    const all = await frames()
    // `save: { includeText: true }` — withholding the body here would be the
    // opposite bug, and a server that only analyses on save would go blind.
    expect(bytesFor(all, 'textDocument/didSave')).toBeGreaterThan(100_000)
  })
})

describe('incremental didChange', () => {
  test('a server that accepts ranged edits gets the DELTA, not the document', async () => {
    respawnFake('incremental')
    const lsp = await connect()
    const file = path.join(dir, 'big.ts')
    const body = `export const x = 1\n`.repeat(50_000) // ~1 MB
    writeFileSync(file, body)

    await lsp.syncDocument(file, body)
    await lsp.syncDocument(file, `${body}// tail\n`)

    const all = await frames()
    const open = bytesFor(all, 'textDocument/didOpen')
    const change = bytesFor(all, 'textDocument/didChange')

    // didOpen still carries the whole document — it has to.
    expect(open).toBeGreaterThan(900_000)
    // The edit that follows must not. Before this, the "incremental" branch declared
    // a full-document range and put the entire buffer inside it.
    expect(change).toBeLessThan(2_000)
  })

  test('a full-sync server is untouched — it still gets the whole document', async () => {
    const lsp = await connect()
    const file = path.join(dir, 'small.ts')
    writeFileSync(file, 'a')

    await lsp.syncDocument(file, 'a')
    await lsp.syncDocument(file, 'ab')

    const all = await frames()
    // No `change: 2` was declared, so the contract is still whole-document.
    expect(bytesFor(all, 'textDocument/didChange')).toBeGreaterThan(0)
  })
})
