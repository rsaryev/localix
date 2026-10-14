// Fetch the Bun the app ships as its sidecar, when it must not be the Bun that ran the build.
//
// The sidecar used to be a copy of whichever Bun executed `prepare-sidecar.mjs`. In CI that is the
// one `oven-sh/setup-bun` installed, and on an x64 Linux or Windows runner setup-bun installs the
// AVX2 build (it checks the RUNNER's CPU, and falls back to AVX2 by default). So the Bun a user
// received was chosen by the build machine's processor, and on a machine without AVX2, which
// includes the generic CPU model of many virtual machines, it dies at start-up with "illegal
// instruction". Bun publishes a `-baseline` build for exactly those CPUs; this fetches it for the
// platforms that have one, at the same version as the build's Bun, and checks it against the
// release's own SHASUMS256.txt before it is trusted.
//
// Opt-in (`LOCALIX_SIDECAR_BASELINE=1`, set by the release workflow): a developer's own build keeps
// copying the Bun they already have, with no network and no download.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The release asset (without `.zip`) that holds the baseline Bun, or undefined where there is none. */
export function baselineAsset({ platform = process.platform, arch = process.arch } = {}) {
  if (arch !== 'x64') return undefined // arm64 builds have no AVX2 requirement to avoid
  if (platform === 'linux') return 'bun-linux-x64-baseline'
  if (platform === 'win32') return 'bun-windows-x64-baseline'
  if (platform === 'darwin') return 'bun-darwin-x64-baseline'
  return undefined
}

/** `{ file: sha256 }` from a `SHASUMS256.txt` body (`<hash>  <file>` per line). */
export function parseShasums(text) {
  const sums = {}
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64}) [ *]?(\S+)$/u.exec(line.trim())
    if (match) sums[match[2]] = match[1]
  }
  return sums
}

const sha256 = (bytes) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

/** Unpack a zip with the tool each platform already has: `unzip`, or bsdtar (`tar`) on Windows. */
function extractZip(zip, into) {
  const [command, args] =
    process.platform === 'win32'
      ? ['tar', ['-xf', zip, '-C', into]]
      : ['unzip', ['-q', '-o', zip, '-d', into]]
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`could not unpack ${zip}: ${result.stderr || result.error?.message}`)
  }
}

/**
 * Download, verify and unpack the baseline Bun `version` into `dest`. Resolves to the path of the
 * executable, or undefined when this platform has no baseline build. Throws, leaving nothing
 * behind, when the download is missing from the release or its checksum differs.
 */
export async function fetchBaselineBun({
  version,
  dest,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = fetch,
  extract = extractZip,
}) {
  const asset = baselineAsset({ platform, arch })
  if (!asset) return undefined
  const exe = join(dest, asset, platform === 'win32' ? 'bun.exe' : 'bun')
  const base = `https://github.com/oven-sh/bun/releases/download/bun-v${version}`

  const get = async (name) => {
    const response = await fetchImpl(`${base}/${name}`)
    if (!response.ok) throw new Error(`${base}/${name} answered ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  const sums = parseShasums(new TextDecoder().decode(await get('SHASUMS256.txt')))
  const expected = sums[`${asset}.zip`]
  if (!expected) throw new Error(`SHASUMS256.txt for bun-v${version} lists no ${asset}.zip`)
  const zipBytes = await get(`${asset}.zip`)
  const actual = sha256(zipBytes)
  if (actual !== expected) {
    throw new Error(`${asset}.zip does not match its published checksum (${actual} != ${expected})`)
  }

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  const zip = join(dest, `${asset}.zip`)
  writeFileSync(zip, zipBytes)
  extract(zip, dest)
  if (!existsSync(exe)) throw new Error(`${asset}.zip did not contain ${exe}`)
  if (platform !== 'win32') chmodSync(exe, 0o755)
  return exe
}

/** Throw unless `exe` runs and reports `version`: a binary for the wrong platform fails here. */
export function assertRunsAs(exe, version) {
  const result = spawnSync(exe, ['--version'], {
    encoding: 'utf8',
    timeout: 20_000,
    killSignal: 'SIGKILL',
  })
  if (result.status !== 0 || result.stdout.trim() !== version) {
    throw new Error(
      `${exe} --version answered ${JSON.stringify(result.stdout?.trim() || result.stderr?.trim())}, expected ${version}`,
    )
  }
}
