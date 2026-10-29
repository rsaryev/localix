import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readUpdaterSettings } from '../apps/desktop-tauri/scripts/build-release-config.mjs'

const root = resolve(import.meta.dir, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const readJson = (path: string) => JSON.parse(read(path))

const rootPackage = readJson('package.json')
const desktopConfig = readJson('apps/desktop-tauri/src-tauri/tauri.conf.json')
const ci = read('.github/workflows/ci.yml')
const release = read('.github/workflows/release.yml')
const releaseRefResolver = read('scripts/resolve-release-ref.mjs')
const releaseRunner = read('apps/desktop-tauri/scripts/run-tauri.mjs')
const prepareSidecar = read('apps/desktop-tauri/scripts/prepare-sidecar.mjs')

const packageManagerVersion = String(rootPackage.packageManager).replace(/^bun@/u, '')
const workflowValues = (source: string, key: string) =>
  [...source.matchAll(new RegExp(`^\\s*${key}:\\s*([^\\s#]+)`, 'gmu'))].map((match) => match[1])

describe('release workflow contract', () => {
  test('is valid YAML with the expected release jobs', () => {
    const workflow = Bun.YAML.parse(release) as Record<string, Record<string, unknown>>
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(Object.keys(workflow.jobs)).toEqual([
      'prepare',
      'verify',
      'draft-release',
      'build-desktop',
      'mini-app-kit',
      'publish-desktop',
    ])
  })

  // Localix ships and hosts no mini app (rule X5): the Localix marketplace's own releases publish
  // its catalog, and the core only names that marketplace as a trusted source.
  test('publishes no mini app catalog of its own', () => {
    expect(release).not.toContain('mini-app-catalog')
  })

  // The authoring plugin builds against the latest release's kit when no Localix is
  // installed, and refuses an archive `SHA256SUMS.txt` does not name: a release without either
  // leaves Claude Code users unable to create a mini app at all.
  test('publishes the mini app kit with the release, named in its checksums', () => {
    const workflow = Bun.YAML.parse(release) as {
      jobs: Record<string, { steps: { name?: string; run?: string }[] }>
    }
    const runs = workflow.jobs['mini-app-kit']!.steps.map((step) => step.run ?? '').join('\n')
    expect(runs).toContain('bun scripts/stage-mini-app-kit.mjs')
    expect(runs).toMatch(/gh release upload [^\n]*mini-app-kit\.tar\.gz/u)
    const checksums = workflow.jobs['publish-desktop']!.steps.find(
      (step) => step.name === 'Write checksums and release notes',
    )!.run!
    const pattern = /test\("([^"]+)"\)/u.exec(checksums)![1]!.replaceAll('\\\\', '\\')
    const named = (asset: string) => new RegExp(pattern, 'u').test(asset)
    expect(named('mini-app-kit.tar.gz')).toBe(true)
    expect(named('Localix-macos-arm64.dmg')).toBe(true)
    expect(named('Localix.app.tar.gz')).toBe(true)
    expect(named('notes-1.2.0-0a1b2c3d.tar.gz')).toBe(false)
  })

  test('accepts release secrets only behind the protected release environment', () => {
    expect(release).not.toMatch(/^\s*push:/mu)
    expect(release).toContain('Require the protected main workflow')
    expect(release).toContain(`if [ "$GITHUB_REF" != 'refs/heads/main' ]`)
    const workflow = Bun.YAML.parse(release) as {
      jobs: Record<string, { environment?: string }>
    }
    for (const job of [
      'verify',
      'draft-release',
      'build-desktop',
      'mini-app-kit',
      'publish-desktop',
    ]) {
      expect(workflow.jobs[job].environment).toBe('release')
    }
    expect(releaseRefResolver).toContain('assertReleaseCommitOnMain(commit)')
  })

  test('uses the reviewed Bun and Rust toolchains in CI and release jobs', () => {
    const setup = read('.github/actions/setup-workspace/action.yml')
    expect(workflowValues(setup, 'bun-version')).toEqual([packageManagerVersion])
    expect(ci).toContain('uses: ./.github/actions/setup-workspace')
    expect(release).toContain('uses: ./.github/actions/setup-workspace')

    const ciRust = workflowValues(ci, 'RUST_TOOLCHAIN')
    const releaseRust = workflowValues(release, 'RUST_TOOLCHAIN')
    expect(ciRust).toHaveLength(1)
    expect(releaseRust).toEqual(ciRust)
    expect(release).toContain('run: bun scripts/require-green-ci.mjs')
    expect(release).toContain('needs: [prepare, verify]')
  })

  test('builds workspace declarations before checking source and test types', () => {
    // Every app slice builds, then runs its own commands (type checks among them).
    expect(ci).toContain('bun run type-check')
    expect(ci.indexOf('name: Check ${{ matrix.check }}')).toBeGreaterThan(
      ci.indexOf('run: bun run build'),
    )
    expect(ci.indexOf('run: bun run build')).toBeGreaterThan(-1)
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
    // No default permissions; every job names its own, and only those mutating the release write.
    expect(release).toMatch(/\npermissions: \{\}\n/u)
    const jobs = (Bun.YAML.parse(release) as { jobs: Record<string, { permissions?: object }> })
      .jobs
    for (const [name, job] of Object.entries(jobs)) {
      expect(job.permissions, `${name} declares permissions`).toBeDefined()
    }
    for (const job of ['draft-release', 'build-desktop', 'publish-desktop']) {
      const start = release.indexOf(`\n  ${job}:`)
      const header = release.slice(start, release.indexOf('    steps:', start))
      expect(header).toContain('permissions:\n      contents: write')
    }
  })

  test('ships only the platforms its matrix builds, and the manifest asks for exactly those', () => {
    const platforms = workflowValues(release, 'RELEASE_PLATFORMS')[0]
    expect(platforms).toBe('darwin-aarch64')
    expect(workflowValues(release, 'RELEASE_EXPERIMENTAL_PLATFORMS')[0]).toBe(
      'darwin-x86_64,linux-x86_64,linux-x86_64-deb,linux-aarch64,linux-aarch64-deb',
    )
    // Only macOS on Apple silicon ships; the other legs are parked in a comment for later.
    expect(release).toContain(`all='[{"os":"macos-15","name":"macos-arm64"}]'`)
    for (const parked of [
      '#   {"os":"ubuntu-22.04","name":"linux-x64","experimental":true}',
      '#   {"os":"macos-15-intel","name":"macos-x64","experimental":true}',
      '#   {"os":"ubuntu-22.04-arm","name":"linux-arm64","experimental":true}',
    ]) {
      expect(release).toContain(parked)
    }
    // An experimental leg never holds the release back; the proven ones always do.
    expect(release).toContain('continue-on-error: ${{ matrix.experimental == true }}')
    expect(release).toContain('include: ${{ fromJSON(needs.prepare.outputs.matrix) }}')
  })

  test('restores and saves the package and task caches in the native build legs', () => {
    const legs = release.slice(
      release.indexOf('  build-desktop:'),
      release.indexOf('  publish-desktop:'),
    )
    const restoreBun = legs.indexOf('uses: ./.github/actions/setup-workspace')
    const install = legs.indexOf("ignore-scripts: 'true'")
    const turboRestore = legs.indexOf('- name: Restore Turbo cache')
    const turboBuild = legs.indexOf('bunx turbo build --filter=@localixai/api')
    const turboSave = legs.indexOf('- name: Save Turbo cache')
    expect(restoreBun).toBeGreaterThan(-1)
    expect(install).toBeGreaterThan(restoreBun)
    expect(turboRestore).toBeGreaterThan(install)
    expect(turboBuild).toBeGreaterThan(turboRestore)
    expect(turboSave).toBeGreaterThan(turboBuild)
  })

  test("ships a sidecar Bun that does not depend on the build runner's CPU", () => {
    expect(release).toContain("LOCALIX_SIDECAR_BASELINE: '1'")
    expect(prepareSidecar).toContain('fetchBaselineBun')
    expect(prepareSidecar).toContain('assertRunsAs')
  })

  test('stamps the desktop version with the shared script, never with inline code', () => {
    expect(release).toContain('bun scripts/stamp-version.mjs "$RELEASE_VERSION"')
    expect(release).not.toContain('c.version = v')
  })

  test("starts the packaged app's API before any asset is collected for upload", () => {
    const smoke = release.indexOf('- name: Smoke the packaged bundle')
    expect(smoke).toBeGreaterThan(release.indexOf('bun run tauri:release'))
    expect(smoke).toBeLessThan(release.indexOf('- name: Collect release assets'))
    expect(release).toContain('apps/desktop-tauri/scripts/smoke-bundle.mjs')
    expect(release).toContain('"${SMOKE[@]}" --root "$BUNDLE/macos/Localix.app"')
  })

  test('bounds every job, so a hung runner cannot burn the six-hour default', () => {
    const jobs = [...release.matchAll(/\n {2}([a-z-]+):\n(?: {4}.*\n)*? {4}runs-on:/gu)]
    expect(jobs.length).toBe(6)
    for (const [, job] of jobs) {
      const start = release.indexOf(`\n  ${job}:`)
      const header = release.slice(start, release.indexOf('    steps:', start))
      expect(header, `${job} needs timeout-minutes`).toMatch(/\n {4}timeout-minutes: \d+\n/u)
    }
  })

  test('writes the release body from the changelog and the assets that were published', () => {
    const publishJob = release.slice(release.indexOf('  publish-desktop:'))
    expect(publishJob).toContain('bun scripts/build-release-notes.mjs')
    expect(publishJob).toContain('releases/generate-notes')
    expect(publishJob).toContain('SHA256SUMS.txt')
    // Checksums and notes exist before the release stops being a draft.
    expect(publishJob.indexOf('SHA256SUMS.txt')).toBeLessThan(
      publishJob.indexOf('- name: Publish release as latest'),
    )
    const notes = readFileSync(resolve(root, 'scripts/build-release-notes.mjs'), 'utf8')
    expect(notes).toContain('the only platform it has been tested')
    expect(notes).toContain('docs/getting-started/installation.md')
  })

  test('announces each version with its changelog section, and refuses one without', () => {
    const verifyJob = release.slice(
      release.indexOf('  verify:'),
      release.indexOf('  draft-release:'),
    )
    expect(verifyJob).toContain('bun scripts/assert-release-changelog.mjs')
    const manifestStep = release.slice(release.indexOf('- name: Generate updater latest.json'))
    expect(manifestStep.slice(0, manifestStep.indexOf('run:'))).toContain('RELEASE_CHANGELOG:')
  })

  test('rechecks mirrored tag provenance immediately before manifest generation and publish', () => {
    const publishStart = release.indexOf('  publish-desktop:')
    const publishJob = release.slice(publishStart)
    const reverify = publishJob.indexOf('- name: Reverify release tag and draft provenance')
    const manifest = publishJob.indexOf('- name: Generate updater latest.json')
    const publish = publishJob.indexOf('- name: Publish release as latest')
    const finalVerification = publishJob.indexOf('bun scripts/verify-release-target.mjs', publish)
    const releaseEdit = publishJob.indexOf('gh release edit', publish)

    expect(publishStart).toBeGreaterThan(-1)
    expect(reverify).toBeGreaterThan(-1)
    expect(manifest).toBeGreaterThan(reverify)
    expect(publish).toBeGreaterThan(manifest)
    expect(finalVerification).toBeGreaterThan(publish)
    expect(releaseEdit).toBeGreaterThan(finalVerification)
  })

  test('publishes every release as latest, a beta included, and never moves latest backwards', () => {
    const publishJob = release.slice(release.indexOf('  publish-desktop:'))
    const publish = publishJob.slice(publishJob.indexOf('- name: Publish release as latest'))
    // The updater reads `releases/latest/download/latest.json`, which GitHub resolves only for a
    // release that is neither a draft nor a prerelease.
    expect(publish).toContain('--draft=false --prerelease=false --latest')
    expect(release).not.toMatch(/--latest=false/u)
    expect(release).not.toMatch(/--prerelease(?!=false)/u)
    // The newer-than-latest check runs before the edit that moves latest.
    expect(publish.indexOf('bun scripts/assert-newest-release.mjs')).toBeGreaterThan(-1)
    expect(publish.indexOf('bun scripts/assert-newest-release.mjs')).toBeLessThan(
      publish.indexOf('gh release edit'),
    )
    // The current latest comes from one lookup that treats only a 404 as "no release yet".
    expect(publish).toContain('CURRENT_LATEST_TAG: ${{ steps.latest.outputs.tag }}')
    const lookup = publishJob.slice(
      publishJob.indexOf('- name: Find the current latest release'),
      publishJob.indexOf('- name: Write checksums and release notes'),
    )
    expect(lookup).toContain('releases/latest')
    expect(lookup).toContain("grep -q 'HTTP 404'")
    expect(release).not.toContain('|| true)"')
  })

  test('gives only release builds an updater, and keeps its endpoint on the release repository', () => {
    // The base config has no updater and no key: a build from a checkout can neither read the
    // official feed nor offer the person an update to it.
    expect(desktopConfig.bundle.createUpdaterArtifacts).toBe(false)
    expect(desktopConfig.plugins.updater).toBeUndefined()
    expect(desktopConfig.bundle.targets).toEqual(['app', 'dmg', 'nsis', 'deb', 'appimage'])

    const releaseRepository = workflowValues(release, 'RELEASE_REPO')[0]
    expect(releaseRepository).toBe('rsaryev/localix')
    expect(readUpdaterSettings({ env: {} }).endpoints).toEqual([
      `https://github.com/${releaseRepository}/releases/latest/download/latest.json`,
    ])
    // The release build is the one that passes `--release`, which writes the overlay and compiles
    // the updater in; the signing-key check reads the key the same way the build does.
    expect(read('apps/desktop-tauri/package.json')).toContain('run-tauri.mjs --release')
    expect(release).toContain('bun run tauri:release')
    expect(release).toContain('bun scripts/verify-updater-signature.mjs')
    expect(read('scripts/verify-updater-signature.mjs')).toContain('readUpdaterSettings().pubkey')
    expect(releaseRunner).toContain("commandEnv.LOCALIX_UPDATER_ENABLED = '1'")
  })

  test('requires every installer and signed updater bundle before publication', () => {
    for (const pattern of [
      'dist-assets/*.dmg',
      'dist-assets/*.app.tar.gz',
      'dist-assets/*.app.tar.gz.sig',
      'dist-assets/*.AppImage',
      'dist-assets/*.AppImage.sig',
      'dist-assets/*.deb',
      'dist-assets/*.deb.sig',
    ]) {
      expect(release).toContain(`require_match '${pattern}'`)
    }
    expect(release).not.toMatch(/\.msi|\.exe|\.rpm|win-x64/u)
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

  test('validates code and updater signatures before any draft mutation', () => {
    const jobs = (
      Bun.YAML.parse(release) as {
        jobs: Record<
          string,
          {
            steps: { name?: string; uses?: string; run?: string }[]
            needs?: string[]
            permissions?: { contents?: string }
          }
        >
      }
    ).jobs
    const verify = jobs.verify.steps
    // Green CI is required in prepare, before the release environment and its secrets.
    const prepare = jobs.prepare.steps
    const green = prepare.findIndex((step) => step.run === 'bun scripts/require-green-ci.mjs')
    expect(green).toBeGreaterThan(
      prepare.findIndex((step) => step.name === 'Resolve tagged source'),
    )
    expect(verify.some((step) => step.run === 'bun scripts/require-green-ci.mjs')).toBe(false)
    const sign = verify.findIndex((step) => step.name === 'Sign updater probe')
    const key = verify.findIndex((step) => step.name === 'Verify probe with shipped public key')
    expect(sign).toBeGreaterThan(-1)
    expect(key).toBeGreaterThan(sign)
    expect(verify[key]?.run).toBe(
      'bun scripts/verify-updater-signature.mjs "$RUNNER_TEMP/updater-signing-probe"',
    )
    // The check needs no Rust build: no toolchain, no cargo.
    expect(verify.some((step) => step.uses === './.github/actions/setup-desktop')).toBe(false)
    expect(release).not.toContain('cargo run')
    expect(jobs.verify.permissions?.contents).not.toBe('write')
    expect(jobs['draft-release'].needs).toEqual(['prepare', 'verify'])
    expect(jobs['draft-release'].permissions?.contents).toBe('write')
    expect(
      jobs['build-desktop'].steps.some((step) => step.uses === './.github/actions/setup-desktop'),
    ).toBe(true)
  })

  test('checks Gatekeeper and every updater signature before any asset is uploaded', () => {
    const legs = release.slice(
      release.indexOf('  build-desktop:'),
      release.indexOf('  publish-desktop:'),
    )
    const gatekeeper = legs.indexOf('- name: Verify macOS signing and notarization')
    const signatures = legs.indexOf('- name: Verify updater signatures')
    const upload = legs.indexOf('- name: Upload release assets to draft release')
    expect(gatekeeper).toBeGreaterThan(legs.indexOf('- name: Smoke the packaged bundle'))
    expect(signatures).toBeGreaterThan(legs.indexOf('- name: Collect release assets'))
    expect(upload).toBeGreaterThan(Math.max(gatekeeper, signatures))
    for (const check of [
      'codesign --verify --deep --strict --verbose=2 "$app"',
      'grep -qx "TeamIdentifier=$team"',
      'xcrun stapler validate "$target"',
      'spctl --assess --type execute --verbose=2 "$app"',
    ]) {
      expect(legs).toContain(check)
    }
    expect(legs).toContain('bun scripts/verify-updater-signature.mjs "${bundles[@]}"')
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
    expect(prepareSidecar).toContain('STAGED_DESKTOP_NOTICE_FILES.every')
    expect(prepareSidecar).toContain("destination: join(resources, 'THIRD_PARTY_NOTICES')")
    // The shipped binary also carries the Bun sidecar and the Rust shell's crates.
    expect(prepareSidecar).toContain('desktop: { targetTriple: hostTriple() }')
    expect(prepareSidecar).toContain("join(desktop, 'src-tauri', 'Cargo.lock')")
    // Resources hold the ONE copy; the embedded frontend writing them too shipped every notice
    // twice, the second compiled into the executable.
    expect(read('apps/ui/vite.config.ts')).not.toContain('stageThirdPartyNotices(')

    const runtimeKeyStart = prepareSidecar.indexOf('const runtimeKey = fingerprint([')
    // The list of inputs ends at its closing bracket; a second argument (the sidecar variant) may follow.
    const runtimeKeyEnd = prepareSidecar.indexOf('\n]', runtimeKeyStart)
    const runtimeKey = prepareSidecar.slice(runtimeKeyStart, runtimeKeyEnd)
    expect(runtimeKeyStart).toBeGreaterThan(-1)
    expect(runtimeKeyEnd).toBeGreaterThan(runtimeKeyStart)
    expect(runtimeKey).toContain("join(repo, 'vendor', 'monaco-editor-runtime')")
  })
})
