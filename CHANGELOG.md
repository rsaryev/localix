# Changelog

Localix is in beta: versions before 1.0 may change behavior between releases.

## Unreleased

Changes land on `main`.

## v0.1.0-beta.3 — draft prepared 2026-10-15

The first beta published after the repository history was reset. Earlier beta tags and their
installers were removed; this release replaces them.

### Added

- Desktop application for macOS on Apple silicon, signed and notarized; it has been run by hand
  there and nowhere else.
- Experimental installers for macOS on Intel and Linux x64 (`.AppImage` and `.deb`), built by the
  same pipeline and not yet run by hand.
- Multi-agent conversations, connected context, Project Space, the agent-driven preview with Visual
  Feedback, plugins the agent can build, loops and monitors, and the bundled workbenches.
- Native browser pages on Linux, hosted in a GTK page layer.
- Building from source is documented in
  [Run Localix from source](docs/getting-started/installation.md).

### Changed

- Providers connect only through credentials stored in the encrypted vault; API keys are never read
  from environment variables.
- Updated dependencies, the pi runtime (v1.2.0) and Monaco (0.57.0).

### Removed

- The agent island and its quick chat window.

## How entries get added

A release is a reviewed manual dispatch of
[`.github/workflows/release.yml`](.github/workflows/release.yml) from `main` with an exact semver
tag (`v1.2.3`) as its input. Pushing a tag does not run release code, because a tag can point at an
unmerged commit. The workflow resolves the tag to one commit, requires that commit to be reachable
from `origin/main`, reruns the repository gates against it, then creates a draft GitHub Release,
uploads the per-platform installers, and publishes the draft. Every published release becomes
`latest`, a tag with a pre-release label (`v1.2.3-beta.1`) included: the updater reads
`releases/latest/download/latest.json`, and GitHub's `latest` skips a prerelease. A version older
than the current latest is refused before the publish.

An entry is therefore written when a tag is prepared, not when a commit merges:

- Prepare a `## v<version> — draft prepared <date>` section below `## Unreleased` for the tag.
  Replace the draft label with the publication date only after the release is public.
- Group its lines under `Added`, `Changed`, `Fixed`, and `Removed`.
- The release body is written by `scripts/build-release-notes.mjs` when the release is published:
  this version's section becomes **Highlights**, GitHub's generated list (grouped by the labels in
  [`.github/release.yml`](.github/release.yml)) becomes **What's changed**, and the download table
  lists only the installers that reached the release. `SHA256SUMS.txt` and build-provenance
  attestations are published with it.
- Platforms: macOS Apple silicon and Linux x64 must build, or the release stays a draft. macOS Intel
  and Linux ARM64 are experimental legs (`"experimental": true` in the matrix): a failed one is
  reported and left out, and its updater entry exists only when its signed artifact does. Only macOS
  on Apple silicon has been run by hand, and the notes say so. Windows has no leg yet.
- Keep the calm, factual register the rest of the repository uses; see
  [Contributing](CONTRIBUTING.md).
