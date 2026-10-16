import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as protocol from '../apps/api/src/lib/runtime-protocol'
import {
  RUST_CONTRACT_FILE,
  checkRuntimeContract,
  renderRuntimeContract,
} from './runtime-contract.mjs'

const root = resolve(import.meta.dir, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const sidecar = read('apps/desktop-tauri/src-tauri/src/sidecar.rs')

describe('the generated Rust contract', () => {
  test('is exactly what the TypeScript source renders', () => {
    expect(checkRuntimeContract()).toBeUndefined()
    expect(readFileSync(RUST_CONTRACT_FILE, 'utf8')).toBe(renderRuntimeContract())
  })

  test('is flagged when the TypeScript changes and the Rust is not regenerated', () => {
    for (const changed of [
      { ...protocol, LOCALIX_RUNTIME_READY_PREFIX: 'LOCALIX_RUNTIME_UP ' },
      { ...protocol, RUNTIME_SHUTDOWN_COMMAND: 'stop' },
      { ...protocol, RUNTIME_ENV: { ...protocol.RUNTIME_ENV, launchId: 'LOCALIX_LAUNCH' } },
      { ...protocol, RUNTIME_ATTACH_WAIT_MS: 13_000 },
      { ...protocol, RUNTIME_READY_FIELDS: { ...protocol.RUNTIME_READY_FIELDS, pid: 'u64' } },
    ]) {
      expect(checkRuntimeContract(changed as typeof protocol)).toContain('does not match')
    }
  })

  test('is flagged when the committed file is edited by hand or missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-contract-'))
    try {
      const file = join(dir, 'runtime_contract.rs')
      expect(checkRuntimeContract(protocol, file)).toContain('does not match')
      writeFileSync(file, `${renderRuntimeContract()}// hand edit\n`)
      expect(checkRuntimeContract(protocol, file)).toContain('does not match')
      writeFileSync(file, renderRuntimeContract())
      expect(checkRuntimeContract(protocol, file)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('renders the values the runtime really uses', () => {
    const rust = renderRuntimeContract()
    expect(rust).toContain('READY_PREFIX: &str = "LOCALIX_RUNTIME_READY ";')
    expect(rust).toContain('SHUTDOWN_COMMAND: &[u8] = b"shutdown\\n";')
    expect(rust).toContain('DESKTOP_RUNTIME_ARG: &str = "--desktop-runtime";')
    expect(rust).toContain('pub(crate) base_url: String,')
    expect(rust).toContain('pub(crate) pid: u32,')
  })

  test('refuses a value Rust would not read back as written', () => {
    expect(() =>
      renderRuntimeContract({ ...protocol, DESKTOP_RUNTIME_ARG: '--desktopé' } as typeof protocol),
    ).toThrow('Not plain ASCII')
  })
})

describe('the shell and the runtime stay on one contract', () => {
  test('sidecar.rs spells none of the shared values itself', () => {
    expect(sidecar).not.toContain('LOCALIX_RUNTIME_READY')
    expect(sidecar).not.toContain('b"shutdown')
    expect(sidecar).not.toContain('"--desktop-runtime"')
    for (const name of Object.values(protocol.RUNTIME_ENV)) {
      expect(sidecar, `${name} must come from runtime_contract`).not.toContain(`"${name}"`)
    }
    expect(sidecar).not.toMatch(/struct RuntimeReady/u)
  })

  test('the runtime reads every environment value the shell sets', () => {
    const api = [
      'apps/api/src/index.ts',
      'apps/api/src/lib/env.ts',
      'apps/api/src/bootstrap/infra.ts',
    ]
      .map(read)
      .join('\n')
    expect(api).toContain('RUNTIME_ENV.parentPid')
    expect(api).toContain(protocol.RUNTIME_ENV.launchId)
    expect(api).toContain(protocol.RUNTIME_ENV.cliEntry)
  })

  test("the shell's own deadlines outlast the runtime's, read from sidecar.rs", () => {
    const seconds = (name: string) => {
      const match = new RegExp(
        `const ${name}: (?:u64|Duration) = (?:Duration::from_secs\\()?(\\d+)`,
      ).exec(sidecar)
      if (!match) throw new Error(`${name} not found in sidecar.rs`)
      return Number(match[1])
    }
    // Also enforced by the Rust compiler (`const _: () = assert!`); this keeps the check running
    // where there is no toolchain, such as `check:release`.
    expect(seconds('READY_TIMEOUT_SECS') * 1000).toBeGreaterThan(protocol.RUNTIME_ATTACH_WAIT_MS)
    expect(seconds('SHUTDOWN_WAIT') * 1000).toBeGreaterThan(protocol.RUNTIME_SHUTDOWN_DEADLINE_MS)
  })

  test('the runtime entry uses the shared constants, not private copies', () => {
    const entry = read('apps/api/src/index.ts')
    expect(entry).toContain('RUNTIME_ATTACH_WAIT_MS')
    expect(entry).toContain('RUNTIME_SHUTDOWN_DEADLINE_MS')
    expect(entry).not.toMatch(/=== 'shutdown'/u)
    expect(entry).not.toMatch(/const DESKTOP_RUNTIME_ARG =/u)
  })
})
