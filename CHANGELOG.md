# Changelog

Localix is in beta: versions before 1.0 may change behavior between releases.

## Unreleased

Changes land on `main`.

## v0.1.0 — 2026-10-05

The first beta.

### Added

- Desktop application for macOS, Apple silicon and Intel, signed and notarized.
- Multi-agent conversations, connected context, Project Space, the agent-driven preview with Visual
  Feedback, plugins the agent can build, loops and monitors, and the bundled workbenches.

## How entries get added

A release is a reviewed manual dispatch of
[`.github/workflows/release.yml`](.github/workflows/release.yml) from `main` with an exact semver
tag (`v1.2.3`) as its input. Pushing a tag does not run release code, because a tag can point at an
unmerged commit. The workflow resolves the tag to one commit, requires that commit to be reachable
from `origin/main`, reruns the repository gates against it, then creates a draft GitHub Release,
uploads the per-platform installers, and publishes the draft. A tag whose core version contains a
hyphen (`v1.2.3-rc.1`) publishes as a prerelease and does not become `latest`.

An entry is therefore written when a tag is prepared, not when a commit merges:

- Add a `## v<version> — <date>` section above `## Unreleased` for the tag being released.
- Group its lines under `Added`, `Changed`, `Fixed`, and `Removed`.
- Name the platforms whose installers that release actually published. The workflow currently runs
  two native build legs (macOS arm64, macOS x64) with `fail-fast: false`, so one broken leg lets the
  other finish and report — but it does not let the release out: `publish-desktop` needs the whole
  `build-desktop` job, and `scripts/build-updater-manifest.mjs` refuses a manifest that is missing a
  signed artifact for any platform listed in `RELEASE_PLATFORMS`. The Windows and Linux legs are
  wired and rejoin the matrix when their installers are ready.
- Keep the calm, factual register the rest of the repository uses; see
  [Contributing](CONTRIBUTING.md).
