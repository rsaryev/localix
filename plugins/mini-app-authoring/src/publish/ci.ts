import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { LOCALIX_REPO } from '../kit/resolve'

/**
 * Publishing through GitHub: the mini app's repository carries its source, and a workflow builds and
 * releases it, so a release is made from the committed source by the same checks Localix applies —
 * never a package someone built on their own computer and uploaded by hand.
 *
 * The workflow runs the toolchain and the kit of ONE Localix release, the one the app was made
 * with: the plugin's folder is checked out alone from Localix's repository at that release's tag
 * (the whole repository is about 200 MB, the toolchain under 1 MB), and the kit comes from that
 * release's assets, verified against its checksums. An app made with a development build follows
 * the latest release instead, since no tag carries that build.
 */

/** Where the workflow is written inside the mini app. */
export const WORKFLOW_FILE = '.github/workflows/mini-app.yml'

/**
 * What git never carries from a mini app: what the checks write (`tsconfig.json` names this
 * computer's kit by absolute path, `KIT.md` is regenerated), builds, dependencies and local data.
 */
export const GENERATED_IGNORES = [
  'node_modules/',
  'dist/',
  '.turbo/',
  '.preview-data/',
  '*.tsbuildinfo',
  'tsconfig.json',
  'KIT.md',
]

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

export interface LocalixPin {
  /** The ref of Localix's repository the toolchain is checked out at. */
  ref: string
  /** The release folder the kit is downloaded from (`MINI_APP_KIT_RELEASES`). */
  kitReleases: string
}

/** The Localix release a kit belongs to, or the latest one for a build no release carries. */
export function localixPin(localixVersion: string | undefined): LocalixPin {
  const releases = `https://github.com/${LOCALIX_REPO}/releases`
  return localixVersion && RELEASE_VERSION.test(localixVersion)
    ? { ref: `v${localixVersion}`, kitReleases: `${releases}/download/v${localixVersion}` }
    : { ref: 'main', kitReleases: `${releases}/latest/download` }
}

/** Add what `GENERATED_IGNORES` lacks to the mini app's `.gitignore`; the lines it added. */
export async function ensureGitignore(dir: string): Promise<string[]> {
  const path = join(dir, '.gitignore')
  const text = await fs.readFile(path, 'utf8').catch(() => '')
  const present = new Set(text.split('\n').map((line) => line.trim()))
  const added = GENERATED_IGNORES.filter((line) => !present.has(line))
  if (added.length) {
    const head = text && !text.endsWith('\n') ? `${text}\n` : text
    await fs.writeFile(path, `${head}${added.join('\n')}\n`)
  }
  return added
}

/** The workflow: check every push and pull request; on a tag `v<version>`, release the catalog. */
export function releaseWorkflow(input: { displayName: string; pin: LocalixPin }): string {
  const { displayName, pin } = input
  const tool = 'localix/plugins/mini-app-authoring/bin/mini-app'
  const onTag = "startsWith(github.ref, 'refs/tags/v')"
  return `# ${displayName}: checked on every push and pull request; a tag v<version> (the version in
# mini-app.json) releases it. People add
#   https://github.com/<owner>/<repo>/releases/latest/download/mini-app-catalog.json
# in Localix's mini app store. Written by \`mini-app ci\`; run it again after updating Localix.
name: Mini app

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

permissions:
  contents: write

env:
  # The Localix this app is built against: its mini app toolchain and its kit.
  LOCALIX_REF: ${pin.ref}
  MINI_APP_KIT_RELEASES: ${pin.kitReleases}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          path: app
      - name: The mini app toolchain
        uses: actions/checkout@v5
        with:
          repository: ${LOCALIX_REPO}
          ref: \${{ env.LOCALIX_REF }}
          path: localix
          sparse-checkout: plugins/mini-app-authoring
          filter: blob:none
      - uses: oven-sh/setup-bun@v2
      - name: Check
        if: \${{ !${onTag} }}
        run: ${tool} check app
      - name: The tag is the version in mini-app.json
        if: \${{ ${onTag} }}
        run: |
          version=$(bun -e "process.stdout.write((await Bun.file('app/mini-app.json').json()).version)")
          if [ "v$version" != "$GITHUB_REF_NAME" ]; then
            echo "::error::The tag $GITHUB_REF_NAME is not v$version, the version in mini-app.json: tag v$version, or raise the version first."
            exit 1
          fi
      - name: Check and pack
        if: \${{ ${onTag} }}
        run: ${tool} pack app --out catalog
      - name: Release
        if: \${{ ${onTag} }}
        env:
          GH_TOKEN: \${{ github.token }}
        run: gh release create "$GITHUB_REF_NAME" catalog/* --repo "$GITHUB_REPOSITORY" --title "${displayName.replaceAll('"', '')} $GITHUB_REF_NAME" --generate-notes
`
}

/**
 * Set a mini app up to be released from GitHub: the workflow, the ignore file, and the publisher
 * kept as `author` in `mini-app.json` (the workflow packs with it). A named publisher replaces the
 * author kept; without one, the kept author stays.
 */
export async function writeReleaseSetup(input: {
  dir: string
  manifest: Record<string, unknown>
  manifestFile: string
  localixVersion: string | undefined
  publisher: string | undefined
}): Promise<LocalixPin> {
  const { dir, manifest, publisher } = input
  if (publisher && manifest.author !== publisher) {
    await fs.writeFile(
      join(dir, input.manifestFile),
      `${JSON.stringify({ ...manifest, author: publisher }, null, 2)}\n`,
    )
  }
  const pin = localixPin(input.localixVersion)
  const displayName = String(manifest.displayName ?? manifest.name ?? 'Mini app')
  await fs.mkdir(join(dir, '.github', 'workflows'), { recursive: true })
  await fs.writeFile(join(dir, WORKFLOW_FILE), releaseWorkflow({ displayName, pin }))
  await ensureGitignore(dir)
  return pin
}
