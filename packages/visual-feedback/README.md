# `@localixai/visual-feedback`

Browser-side protocol, host helpers, and injected probe for Visual Feedback in Localix previews. The
API bundles and injects the probe; the UI consumes the protocol and turns captures into session
context.

## Consumers

The
[API preview injector](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/preview/probe-inject.ts)
bundles `probe-entry` into served preview HTML. The
[preview UI bridge](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/useVisualFeedback.ts)
imports the protocol, and the
[feedback layer](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/VisualFeedbackLayer.tsx)
uses the host payload builder.

## Public entry points

| Entry point                                 | Contract                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@localixai/visual-feedback`                | Pure browser-safe barrel containing the bridge protocol and `buildPreviewCommentsMessage`; it does not include the probe runtime.                         |
| `@localixai/visual-feedback/protocol`       | Side-effect-free message constants and types for picks, source hints, commands, snapshots, screenshots, console entries, and host/probe events.           |
| `@localixai/visual-feedback/host`           | `VfComment` and the pure Markdown payload builder, including host-side capture clamping and secret-pattern redaction.                                     |
| `@localixai/visual-feedback/keys`           | Pure key-name aliases and `normalizeKeyName` for probe-driven keyboard events.                                                                            |
| `@localixai/visual-feedback/secret-shapes`  | Pure token-pattern detection and redaction shared by captures and API diagnostics; no DOM or probe runtime.                                               |
| `@localixai/visual-feedback/embedded`       | `createEmbeddedActuator` runs the shared command vocabulary against a host-supplied panel element; the host owns command permissions and console sources. |
| `@localixai/visual-feedback/console-buffer` | `createConsoleBuffer`, console capture installation, and their types; importing the module does not install capture.                                      |
| `@localixai/visual-feedback/probe-entry`    | Self-mounting DOM entry used by the API bundler. It installs selection, overlays, source resolution, page control, capture, and the parent-window bridge. |

## Limits

- The probe controls only documents where the host injects it; it does not inspect unrelated browser
  tabs or desktop windows. Visual Feedback selection stays disabled until the host activates comment
  mode. On mount, the probe installs its bridge, diagnostics capture, overlay infrastructure, and
  non-blocking dialog hooks.
- Source resolution is best effort: stamped source attributes and development framework metadata can
  provide a line; otherwise the resolver can identify only the served file or return no source.
- Embedded actuation requires a host-owned DOM element and a console buffer. The host must reject
  commands inappropriate for its own document, such as unrestricted evaluation.
- The package root deliberately excludes DOM and probe code. Import `probe-entry` only for bundling
  and injection, not into the host UI bundle.
- Capture redaction is pattern-based and field-bounded, not general classification of every kind of
  sensitive visible text.
- In-page screenshot commands use the package's `modern-screenshot` runtime dependency.

## Source of truth

- [Package exports](./package.json)
- [Root barrel](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/index.ts)
- [Bridge protocol](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/protocol/index.ts)
- [Host payload builder](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/host/payload.ts)
- [Embedded panel actuation](src/embedded/index.ts)
- [Console buffer and optional capture installation](src/actuate/console-capture.ts)
- [Probe entry](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/probe/entry.ts)
- [Source resolver](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/source/index.ts)
- [Visual Feedback guide](https://github.com/rsaryev/localix/blob/main/docs/features/visual-feedback.md)
