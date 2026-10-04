import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const readJson = (path: string) => JSON.parse(read(path))

const rootPackage = readJson('package.json')
const desktopConfig = readJson('apps/desktop-tauri/src-tauri/tauri.conf.json')
const releaseConfig = readJson('apps/desktop-tauri/src-tauri/tauri.release.conf.json')
const ci = read('.github/workflows/ci.yml')
const release = read('.github/workflows/release.yml')
const releaseRefResolver = read('scripts/resolve-release-ref.mjs')
const releaseRunner = read('apps/desktop-tauri/scripts/run-tauri.mjs')
const prepareSidecar = read('apps/desktop-tauri/scripts/prepare-sidecar.mjs')

const packageManagerVersion = String(rootPackage.packageManager).replace(/^bun@/u, '')
const workflowValues = (source: string, key: string) =>
  [...source.matchAll(new RegExp(`^\\s*${key}:\\s*([^\\s#]+)`, 'gmu'))].map((match) => match[1])

const unscheduledTests = (files: string[], commands: string): string[] => {
  const scheduled = new Set(commands.split(/\s+/u))
  return files.filter((file) => !scheduled.has(file)).sort()
}

describe('release workflow contract', () => {
  // A guard left out of the explicit runner silently disappears from both CI and release checks.
  // Discover the script tests so adding one requires wiring it into a mandatory verification gate.
  test('schedules every repository script test through a required verification gate', () => {
    const files = [...new Bun.Glob('scripts/**/*.test.ts').scanSync({ cwd: root })]
    expect(files.length).toBeGreaterThan(0)
    expect(
      unscheduledTests(
        files,
        `${rootPackage.scripts['test:repo']} ${rootPackage.scripts['check:release']}`,
      ),
    ).toEqual([])
  })

  test('positive control: the coverage detector reports an unscheduled guard', () => {
    expect(
      unscheduledTests(
        ['scripts/first.test.ts', 'scripts/missing.test.ts'],
        'bun test scripts/first.test.ts',
      ),
    ).toEqual(['scripts/missing.test.ts'])
  })

  test('is valid YAML with the expected release jobs', () => {
    const workflow = Bun.YAML.parse(release) as Record<string, Record<string, unknown>>
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(Object.keys(workflow.jobs)).toEqual([
      'prepare',
      'verify',
      'verify-rust',
      'verify-signing-key',
      'draft-release',
      'build-desktop',
      'publish-desktop',
    ])
  })

  test('accepts release secrets only behind the protected release environment', () => {
    expect(release).not.toMatch(/^\s*push:/mu)
    expect(release).toContain('Require the protected main workflow')
    expect(release).toContain(`if [ "$GITHUB_REF" != 'refs/heads/main' ]`)
    for (const job of ['verify-signing-key', 'draft-release', 'build-desktop', 'publish-desktop']) {
      const start = release.indexOf(`  ${job}:`)
      const nextJob = release.indexOf('\n  # ──', start)
      const body = release.slice(start, nextJob === -1 ? undefined : nextJob)
      expect(start).toBeGreaterThan(-1)
      expect(body).toContain('environment: release')
    }
    expect(releaseRefResolver).toContain('assertReleaseCommitOnMain(commit)')
  })

  test('uses the reviewed Bun and Rust toolchains in CI and release jobs', () => {
    expect(workflowValues(ci, 'bun-version')).not.toBeEmpty()
    expect(workflowValues(release, 'bun-version')).not.toBeEmpty()
    expect(new Set(workflowValues(ci, 'bun-version'))).toEqual(new Set([packageManagerVersion]))
    expect(new Set(workflowValues(release, 'bun-version'))).toEqual(
      new Set([packageManagerVersion]),
    )

    const ciRust = workflowValues(ci, 'RUST_TOOLCHAIN')
    const releaseRust = workflowValues(release, 'RUST_TOOLCHAIN')
    expect(ciRust).toHaveLength(1)
    expect(releaseRust).toEqual(ciRust)
    expect(release).toContain('run: bun run check:rust')
    expect(release).toContain('needs: [prepare, verify, verify-rust, verify-signing-key]')
  })

  test('builds workspace declarations before validating plugin manifests', () => {
    expect(ci.indexOf('run: bun run check:plugins')).toBeGreaterThan(
      ci.indexOf('run: bun run build'),
    )

    const verifyStart = release.indexOf('  verify:')
    const verifyEnd = release.indexOf('\n  verify-rust:', verifyStart)
    const verifyJob = release.slice(verifyStart, verifyEnd)
    expect(verifyJob.indexOf('bun run build')).toBeGreaterThan(-1)
    expect(verifyJob.indexOf('bun run check:plugins')).toBeGreaterThan(
      verifyJob.indexOf('bun run build'),
    )
  })

  test('publishes to this repository with the workflow token, scoped per job', () => {
    expect(release).not.toContain('secrets.GITHUB_TOKEN')
    expect(release).not.toContain('secrets.RELEASE_TOKEN')
    const tokenBindings = release
      .split(/\r?\n/u)
      .filter((line) => line.includes('GH_TOKEN:'))
      .map((line) => line.trim())
    expect(tokenBindings).not.toBeEmpty()
    for (const binding of tokenBindings) {
      expect(binding).toBe('GH_TOKEN: ${{ github.token }}')
    }
    // The workflow default stays read-only; only the jobs that mutate the release may write.
    expect(release).toMatch(/\npermissions:\n {2}contents: read\n/u)
    for (const job of ['draft-release', 'build-desktop', 'publish-desktop']) {
      const start = release.indexOf(`\n  ${job}:`)
      const header = release.slice(start, release.indexOf('    steps:', start))
      expect(header).toContain('permissions:\n      contents: write')
    }
  })

  test('ships only the platforms its matrix builds, and the manifest asks for exactly those', () => {
    const platforms = workflowValues(release, 'RELEASE_PLATFORMS')[0]
    expect(platforms).toBe('darwin-aarch64,darwin-x86_64')
    expect(release).toContain('- { os: macos-15, name: macos-arm64 }')
    expect(release).toContain('- { os: macos-15-intel, name: macos-x64 }')
    expect(release).not.toContain('- { os: windows-latest, name: win-x64 }')
    expect(release).not.toContain('- { os: ubuntu-22.04, name: linux-x64 }')
  })

  test('rechecks mirrored tag provenance immediately before manifest generation and publish', () => {
    const publishStart = release.indexOf('  publish-desktop:')
    const publishJob = release.slice(publishStart)
    const reverify = publishJob.indexOf('- name: Reverify release tag and draft provenance')
    const manifest = publishJob.indexOf('- name: Generate updater latest.json')
    const publish = publishJob.indexOf('- name: Publish stable or prerelease')
    const finalVerification = publishJob.indexOf('bun scripts/verify-release-target.mjs', publish)
    const releaseEdit = publishJob.indexOf('gh release edit', publish)

    expect(publishStart).toBeGreaterThan(-1)
    expect(reverify).toBeGreaterThan(-1)
    expect(manifest).toBeGreaterThan(reverify)
    expect(publish).toBeGreaterThan(manifest)
    expect(finalVerification).toBeGreaterThan(publish)
    expect(releaseEdit).toBeGreaterThan(finalVerification)
  })

  test('enables updater artifacts only for releases and keeps endpoint ownership aligned', () => {
    expect(desktopConfig.bundle.createUpdaterArtifacts).toBe(false)
    expect(releaseConfig.bundle.createUpdaterArtifacts).toBe(true)
    expect(desktopConfig.bundle.targets).toEqual(['app', 'dmg', 'nsis', 'deb', 'appimage'])

    const releaseRepository = workflowValues(release, 'RELEASE_REPO')[0]
    expect(releaseRepository).toBe('rsaryev/localix')
    expect(desktopConfig.plugins.updater.endpoints).toEqual([
      `https://github.com/${releaseRepository}/releases/latest/download/latest.json`,
    ])
    expect(release).toContain('--example verify_updater_signature')
  })

  test('requires every installer and signed updater bundle before publication', () => {
    for (const pattern of [
      'dist-assets/*.dmg',
      'dist-assets/*.app.tar.gz',
      'dist-assets/*.app.tar.gz.sig',
      'dist-assets/*.exe',
      'dist-assets/*.exe.sig',
      'dist-assets/*.AppImage',
      'dist-assets/*.AppImage.sig',
      'dist-assets/*.deb',
      'dist-assets/*.deb.sig',
    ]) {
      expect(release).toContain(`require_match '${pattern}'`)
    }
    expect(release).toMatch(/case "\$\{\{ matrix\.name \}\}" in[\s\S]*?\n\s+win-x64\)/u)
    expect(release).not.toMatch(/\.msi|\.rpm/u)
  })

  test('preflights every documented Apple signing and notarization value', () => {
    const preflight = releaseRunner.slice(
      releaseRunner.indexOf("if (notarizeDmg && process.platform === 'darwin')"),
      releaseRunner.indexOf("if (process.platform === 'darwin' && !notarizeDmg)"),
    )
    for (const variable of [
      'APPLE_CERTIFICATE',
      'APPLE_CERTIFICATE_PASSWORD',
      'APPLE_SIGNING_IDENTITY',
      'APPLE_API_KEY',
      'APPLE_API_ISSUER',
      'APPLE_API_KEY_PATH',
    ]) {
      expect(preflight).toContain(`'${variable}'`)
    }
    expect(release).toContain('APPLE_API_KEY_B64 is required for a macOS release')
    expect(release).toContain('umask 077')
    expect(release).toContain(`printf '%s' "$APPLE_API_KEY_B64" | base64 --decode`)
  })

  test('imports the Apple identity before beforeBuildCommand signs nested resources', () => {
    const certificateImport = release.indexOf(
      '- name: Import Apple signing certificate before sidecar staging',
    )
    const desktopBuild = release.indexOf(
      '- name: Build desktop release and signed updater artifacts',
    )

    expect(certificateImport).toBeGreaterThan(-1)
    expect(desktopBuild).toBeGreaterThan(certificateImport)
    expect(release).toContain('security import "$CERTIFICATE_PATH" -k "$KEYCHAIN_PATH"')
    expect(release).not.toContain('-A -t cert -f pkcs12')
    expect(release).toContain('security set-key-partition-list -S apple-tool:,apple:,codesign:')
    expect(release).toContain('grep -F -- "$APPLE_SIGNING_IDENTITY"')
    expect(release).not.toContain('-P "$APPLE_CERTIFICATE_PASSWORD" -A')
    expect(release).toContain('- name: Remove temporary Apple signing material')
    expect(release).toContain("if: always() && runner.os == 'macOS'")
    expect(release).toContain('"$RUNNER_TEMP/apple-api-key.p8"')
  })

  test('installs native Linux dependencies before compiling each Rust release check', () => {
    const dependencyInstall = 'libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf'
    for (const job of ['verify-rust:', 'verify-signing-key:']) {
      const start = release.indexOf(`  ${job}`)
      const end = release.indexOf('\n  # ──', start)
      expect(start).toBeGreaterThan(-1)
      expect(release.slice(start, end)).toContain(dependencyInstall)
    }
  })

  test('desktop staging cache covers packaging, UI configuration, and build identity', () => {
    for (const input of [
      "join(desktop, 'scripts')",
      "join(repo, 'scripts', 'build-visual-feedback-probe.mjs')",
      "join(repo, 'scripts', 'stage-third-party-notices.mjs')",
      "join(repo, 'apps', 'ui')",
      "join(repo, 'apps', 'api')",
      "join(repo, 'tsconfig.base.json')",
      "join(repo, 'vendor', 'monaco-editor-runtime')",
      "join(repo, 'LICENSE')",
      '[buildStamp]',
    ]) {
      expect(prepareSidecar).toContain(input)
    }
    expect(prepareSidecar).toContain(
      "copyFileSync(join(repo, 'LICENSE'), join(resources, 'LICENSE'))",
    )
    expect(prepareSidecar).toContain("existsSync(join(resources, 'LICENSE'))")
    expect(prepareSidecar).toContain('STAGED_THIRD_PARTY_NOTICE_FILES.every')
    expect(prepareSidecar).toContain("destination: join(resources, 'THIRD_PARTY_NOTICES')")
    // Resources hold the ONE copy; the embedded frontend writing them too shipped every notice
    // twice, the second compiled into the executable.
    expect(read('apps/ui/vite.config.ts')).not.toContain('stageThirdPartyNotices(')

    const runtimeKeyStart = prepareSidecar.indexOf('const runtimeKey = fingerprint([')
    const runtimeKeyEnd = prepareSidecar.indexOf('\n])', runtimeKeyStart)
    const runtimeKey = prepareSidecar.slice(runtimeKeyStart, runtimeKeyEnd)
    expect(runtimeKeyStart).toBeGreaterThan(-1)
    expect(runtimeKeyEnd).toBeGreaterThan(runtimeKeyStart)
    expect(runtimeKey).toContain("join(repo, 'vendor', 'monaco-editor-runtime')")
  })
})
