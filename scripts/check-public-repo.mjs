import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const requiredFiles = [
  'README.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  '.dockerignore',
  'apps/landing/Dockerfile',
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/pull_request_template.md',
]

await Promise.all(requiredFiles.map((path) => access(join(root, path))))

const communityFileContracts = [
  {
    path: '.github/ISSUE_TEMPLATE/bug_report.yml',
    required: ['id: reproduction', 'id: environment', 'security vulnerability'],
  },
  {
    path: '.github/ISSUE_TEMPLATE/feature_request.yml',
    required: ['id: problem', 'id: outcome', 'Alternatives considered'],
  },
  {
    path: '.github/ISSUE_TEMPLATE/config.yml',
    required: ['blank_issues_enabled: false', '/security/advisories/new'],
  },
  {
    path: '.github/pull_request_template.md',
    required: ['## Summary', '## Evidence', '## Risk and rollback', 'CONTRIBUTING.md'],
  },
]
for (const contract of communityFileContracts) {
  const content = await readFile(join(root, contract.path), 'utf8')
  for (const marker of contract.required) {
    assert(content.includes(marker), `${contract.path} must include: ${marker}`)
  }
}

const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
assert.equal(rootPackage.private, true, 'The monorepo root must never be publishable to npm')

const workspacePackages = []
for (const directory of ['apps', 'packages', 'plugins']) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packagePath = join(root, directory, entry.name, 'package.json')
    if (!existsSync(packagePath)) continue
    workspacePackages.push({
      path: `${directory}/${entry.name}/package.json`,
      manifest: JSON.parse(await readFile(packagePath, 'utf8')),
    })
  }
}
for (const { path, manifest } of workspacePackages) {
  if (manifest.private === true) continue
  assert.equal(
    manifest.publishConfig?.access,
    'public',
    `${path} must be private or explicitly opt into public npm publishing`,
  )
  assert.equal(manifest.license, 'MIT', `${path} must declare its package license`)
  assert.equal(
    manifest.repository?.url,
    'git+https://github.com/rsaryev/localix.git',
    `${path} must point npm provenance to the public repository`,
  )
  assert.equal(manifest.homepage, 'https://localix.ai', `${path} must declare the project homepage`)
  assert.equal(
    manifest.bugs?.url,
    'https://github.com/rsaryev/localix/issues',
    `${path} must direct package issues to the public tracker`,
  )
  if (manifest.files?.includes('src')) {
    for (const exclusion of ['!src/**/*.test.ts', '!src/**/*.test.tsx', '!src/**/__snapshots__']) {
      assert(
        manifest.files.includes(exclusion),
        `${path} ships source and must exclude test payloads with ${exclusion}`,
      )
    }
  }
}

const visualFeedbackManifest = workspacePackages.find(
  ({ manifest }) => manifest.name === '@localixai/visual-feedback',
)?.manifest
assert(visualFeedbackManifest, 'visual-feedback package manifest must be present')
for (const probeEntry of ['./dist/probe/entry.js', './src/probe/entry.ts']) {
  assert(
    visualFeedbackManifest.sideEffects?.includes(probeEntry),
    `visual-feedback self-mounting probe must retain its side effect: ${probeEntry}`,
  )
}

const desktopCargoManifest = await readFile(
  join(root, 'apps/desktop-tauri/src-tauri/Cargo.toml'),
  'utf8',
)
const glibPatchRoot = 'apps/desktop-tauri/src-tauri/vendor/glib-0.18.5'
const glibVariantIter = await readFile(join(root, glibPatchRoot, 'src/variant_iter.rs'), 'utf8')
const glibPatchRecord = await readFile(join(root, glibPatchRoot, 'LOCALIX_PATCH.md'), 'utf8')
assert(
  desktopCargoManifest.includes('glib = { path = "vendor/glib-0.18.5" }'),
  'Desktop Cargo.toml must keep the reviewed glib soundness backport active',
)
assert(
  glibVariantIter.includes('let mut p: *mut libc::c_char = std::ptr::null_mut();') &&
    glibVariantIter.includes('&mut p,'),
  `${glibPatchRoot} must retain the RUSTSEC-2024-0429 out-argument fix`,
)
for (const marker of [
  '233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5',
  'RUSTSEC-2024-0429',
  'b5a4071e439bef2b5eea76c3aa25e5ae84839e34',
]) {
  assert(
    glibPatchRecord.includes(marker),
    `${glibPatchRoot}/LOCALIX_PATCH.md must include ${marker}`,
  )
}

// Include untracked, non-ignored files as well as the index. This makes the gate
// useful before a contributor stages a new document or credential-looking file;
// in CI the same set naturally collapses to tracked files only.
const repositoryFilesResult = spawnSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
assert.equal(
  repositoryFilesResult.status,
  0,
  `Unable to enumerate repository files: ${repositoryFilesResult.stderr}`,
)

const repositoryFiles = repositoryFilesResult.stdout
  .split('\0')
  .filter((file) => file && existsSync(join(root, file)))

// `localix` is the only repository in the organisation that a reader can open. Naming the
// retired ones here to blocklist them would republish the very names the check exists to
// retire, and would miss the next one; allowlisting the canonical repository instead needs
// no such list and fails closed on any name that has not been made public.
const CANONICAL_REPOSITORY = 'localix'
const stalePublicRepositoryReferences = []
const publicReferenceFiles = repositoryFiles.filter(
  (file) =>
    file === 'README.md' ||
    file.startsWith('.github/') ||
    file.startsWith('apps/landing/') ||
    file.startsWith('docs/') ||
    file.startsWith('plugins/') ||
    file.endsWith('/package.json'),
)
for (const file of publicReferenceFiles) {
  if (!/\.(?:html|json|md|mjs|ts|tsx|ya?ml)$/u.test(file)) continue
  const content = await readFile(join(root, file), 'utf8')
  content.split(/\r?\n/u).forEach((line, index) => {
    for (const match of line.matchAll(/https:\/\/github\.com\/localixai\/([A-Za-z0-9._-]+)/gu)) {
      // `repository.url` clones carry a `.git` suffix; it names the same repository.
      const repository = match[1].replace(/\.git$/u, '')
      if (repository === CANONICAL_REPOSITORY) continue
      stalePublicRepositoryReferences.push(`${file}:${index + 1} -> ${repository}`)
    }
  })
}
assert.deepEqual(
  stalePublicRepositoryReferences,
  [],
  `Public-facing files link to a repository other than localixai/${CANONICAL_REPOSITORY}:\n${stalePublicRepositoryReferences.join('\n')}`,
)

const genericFixtureUsers = new Set(['dev', 'me', 'nobody', 'someone', 'x'])
const personalHomePaths = []
for (const file of repositoryFiles) {
  if (!/\.(?:c|cjs|css|html|js|json|jsx|md|mjs|rs|sh|toml|ts|tsx|txt|ya?ml|zsh)$/u.test(file)) {
    continue
  }
  const content = await readFile(join(root, file), 'utf8')
  for (const match of content.matchAll(/\/Users\/([A-Za-z0-9._-]+)\//gu)) {
    if (!genericFixtureUsers.has(match[1])) personalHomePaths.push(`${file}: /Users/${match[1]}/`)
  }
}
assert.deepEqual(
  personalHomePaths,
  [],
  `Public source must use synthetic home paths instead of contributor metadata:\n${personalHomePaths.join('\n')}`,
)

const forbiddenRepositoryPatterns = [
  { pattern: /(^|\/)\.DS_Store$/u, reason: 'OS metadata' },
  { pattern: /(^|\/)\.env(?:\.|$)/u, reason: 'environment/credential file' },
  { pattern: /^\.localix\//u, reason: 'per-checkout Localix runtime state' },
  {
    pattern: /(^|\/)(?:\.turbo|coverage|dist|node_modules|target)\/(?!.*\.gitkeep$)/u,
    reason: 'generated or dependency output',
  },
  { pattern: /\.(?:log|sqlite|sqlite-shm|sqlite-wal|tgz)$/u, reason: 'runtime or packed output' },
  {
    pattern: /\.(?:pem|p12|pfx|key)$/u,
    reason: 'private key or certificate container',
  },
]

const forbiddenRepositoryFiles = []
for (const file of repositoryFiles) {
  if (file === 'vendor/monaco-editor-runtime/esm/external/@vscode/l10n/dist/browser.js') continue
  const match = forbiddenRepositoryPatterns.find(({ pattern }) => pattern.test(file))
  if (match) forbiddenRepositoryFiles.push(`${file} (${match.reason})`)
}
assert.deepEqual(
  forbiddenRepositoryFiles,
  [],
  `Public-repo hygiene rejected repository files:\n${forbiddenRepositoryFiles.join('\n')}`,
)

// Rustdoc-style links in third-party crate READMEs (for example
// `[Variant](struct@Variant)`) are resolved by rustdoc, not as repository
// paths. The vendored crate is verified through Cargo and its recorded
// provenance instead of treating upstream API docs as Localix Markdown.
const repositoryMarkdown = repositoryFiles.filter(
  (file) =>
    file.endsWith('.md') && !file.startsWith('apps/desktop-tauri/src-tauri/vendor/glib-0.18.5/'),
)
const localPathLeaks = []
const brokenMarkdownLinks = []
let localMarkdownLinkCount = 0
for (const file of repositoryMarkdown) {
  const content = await readFile(join(root, file), 'utf8')
  const lines = content.split(/\r?\n/u)
  for (const [index, line] of lines.entries()) {
    if (/\/Users\/[^/\s`]+\/|[A-Za-z]:\\Users\\[^\\\s`]+\\/u.test(line)) {
      localPathLeaks.push(`${file}:${index + 1}`)
    }
  }

  // Ignore examples in code: documentation frequently explains `[label](url)`
  // syntax and command templates that are not navigation.
  const prose = content.replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/gu, '').replace(/`[^`\r\n]*`/gu, '')
  for (const match of prose.matchAll(/!?\[[^\]\r\n]*\]\(([^)\r\n]+)\)/gu)) {
    const rawTarget = match[1].trim()
    const angleTarget = /^<([^>]+)>/u.exec(rawTarget)?.[1]
    const target = angleTarget ?? rawTarget.split(/\s+(?=["'])/u)[0]
    if (!target || target.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target)) {
      continue
    }
    let path = target.split('#')[0].split('?')[0]
    try {
      path = decodeURIComponent(path)
    } catch {
      brokenMarkdownLinks.push(`${file} -> ${target} (invalid URL encoding)`)
      continue
    }
    const absolute = resolve(dirname(join(root, file)), path)
    localMarkdownLinkCount += 1
    const escapes = absolute !== root && !absolute.startsWith(`${root}${sep}`)
    // An uncaptured screenshot slot is declared ahead of the photograph on purpose,
    // so the docs can be written first. It is a content gap, not a broken link — the
    // docs build reports the outstanding list. A path that ESCAPES the repo is still
    // a defect even under this directory.
    const pendingShot =
      !escapes && absolute.startsWith(join(root, 'docs', 'assets', 'screenshots') + sep)
    if (escapes || (!existsSync(absolute) && !pendingShot)) {
      brokenMarkdownLinks.push(`${file} -> ${target}`)
    }
  }
}
assert.deepEqual(
  localPathLeaks,
  [],
  `Public documentation contains contributor-specific home paths:\n${localPathLeaks.join('\n')}`,
)
assert.deepEqual(
  brokenMarkdownLinks,
  [],
  `Public documentation contains broken or escaping local links:\n${brokenMarkdownLinks.join('\n')}`,
)

const readme = await readFile(join(root, 'README.md'), 'utf8')
for (const link of ['CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'LICENSE']) {
  assert(readme.includes(link), `README.md must link to ${link}`)
}

const contributing = await readFile(join(root, 'CONTRIBUTING.md'), 'utf8')
const requiredValidationCommands = [
  'bun run check:vendor',
  'bun run check:public',
  'bun run check:release',
  'bun run check:architecture',
  'bun run check:docs',
  'bun run check:plugins',
  'bun run check:audit',
  'bun run format:check',
  'bun run type-check',
  'bun run check:tests',
  'bun run lint',
  'bun run check:deadcode',
  'bun run build',
  'bun run test',
  'bun run check:globals',
  'bun run test:dropins',
]
for (const command of requiredValidationCommands) {
  assert(contributing.includes(command), `CONTRIBUTING.md must document: ${command}`)
}

const ci = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8')
const requiredCiGates = ['bun install --frozen-lockfile', ...requiredValidationCommands]
for (const gate of requiredCiGates) {
  assert(ci.includes(gate), `CI must run: ${gate}`)
}

const release = await readFile(join(root, '.github/workflows/release.yml'), 'utf8')
for (const gate of requiredCiGates) {
  assert(release.includes(gate), `Release validation must run: ${gate}`)
}
assert(ci.includes('bun run check:rust'), 'CI must run the Rust gate')
assert(release.includes('bun run check:rust'), 'Release validation must run the Rust gate')
assert(
  release.includes('needs: [prepare, verify, verify-rust, verify-signing-key]'),
  'Release mutation must wait for tagged JavaScript and Rust validation',
)
assert(
  !release.includes('secrets.GITHUB_TOKEN'),
  'Release publication must use the scoped workflow token, not secrets.GITHUB_TOKEN',
)
assert(
  !release.includes('secrets.RELEASE_TOKEN'),
  'Release publication happens in this repository; RELEASE_TOKEN is no longer used',
)
const ciRustToolchain = ci.match(/RUST_TOOLCHAIN:\s*([^\s]+)/u)?.[1]
const releaseRustToolchain = release.match(/RUST_TOOLCHAIN:\s*([^\s]+)/u)?.[1]
assert(ciRustToolchain, 'CI must pin a Rust toolchain')
assert.equal(releaseRustToolchain, ciRustToolchain, 'CI and release Rust toolchains must match')

for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
  const content = await readFile(join(root, workflow), 'utf8')
  for (const match of content.matchAll(/\buses:\s*([^\s@]+)@([^\s#]+)/gu)) {
    assert.match(
      match[2],
      /^[0-9a-f]{40}$/u,
      `${workflow} must pin ${match[1]} to a full commit SHA`,
    )
  }
}

const landingDockerfile = await readFile(join(root, 'apps/landing/Dockerfile'), 'utf8')
const dockerBaseImages = [...landingDockerfile.matchAll(/^\s*FROM\s+(\S+)/gimu)].map(
  (match) => match[1],
)
assert(dockerBaseImages.length > 0, 'apps/landing/Dockerfile must declare a base image')
for (const image of dockerBaseImages) {
  assert.match(image, /@sha256:[0-9a-f]{64}$/u, `Docker base image must pin a digest: ${image}`)
}

const landingIndex = await readFile(join(root, 'apps/landing/index.html'), 'utf8')
assert(
  landingIndex.includes('https://localix.ai/og.png'),
  'landing social metadata must use the raster Open Graph image',
)
await access(join(root, 'apps/landing/public/og.png'))

const landingNginx = await readFile(join(root, 'apps/landing/nginx.conf'), 'utf8')
for (const contract of [
  'location = /docs',
  'try_files $uri.html =404;',
  'try_files $uri $uri/ =404;',
]) {
  assert(landingNginx.includes(contract), `landing nginx must include: ${contract}`)
}
assert(
  !landingNginx.includes('/index.html;'),
  'landing nginx must not turn unknown routes into soft-404 home pages',
)

const netlifyConfig = await readFile(join(root, 'apps/landing/netlify.toml'), 'utf8')
assert(
  netlifyConfig.includes('to = "/docs/:splat.html"') &&
    !netlifyConfig.includes('to = "/index.html"'),
  'Netlify must serve static docs shells without a global SPA fallback',
)
const vercelConfig = JSON.parse(await readFile(join(root, 'apps/landing/vercel.json'), 'utf8'))
assert.deepEqual(vercelConfig.rewrites, [
  { source: '/docs/:slug', destination: '/docs/:slug.html' },
])

const dockerIgnore = await readFile(join(root, '.dockerignore'), 'utf8')
for (const rule of [
  '.git',
  '.localix',
  'skills-lock.json',
  'node_modules',
  '**/node_modules',
  'target',
  '**/target',
  'tmp',
  '**/tmp',
  '.env',
  '.env.*',
  'vendor/monaco-editor',
  'apps/desktop-tauri/src-tauri/binaries',
  'apps/desktop-tauri/src-tauri/gen',
  'apps/desktop-tauri/src-tauri/resources',
  'packages/cli/public',
  'packages/cli/server',
]) {
  assert(
    dockerIgnore.split(/\r?\n/u).includes(rule),
    `.dockerignore must exclude the repository-noise path: ${rule}`,
  )
}

console.log(
  `[public] ${requiredFiles.length} community/release files, ${workspacePackages.length} workspace manifests, ${localMarkdownLinkCount} local documentation links, and ${repositoryFiles.length} repository paths are clean.`,
)
