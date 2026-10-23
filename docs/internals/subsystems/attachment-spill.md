# Attachment spill-to-disk

Attachment spill-to-disk replaces large or non-native model attachments with a small manifest and an
agent-readable file path on the model wire. It keeps the persisted message intact and gives
compatible file tools a path to inspect later.

**Boundary:** Spilling is a run-time wire transform. It neither deletes nor rewrites the attachment
stored for the transcript.

## Terminology

| Term              | Meaning                                                                           | Boundary                                      |
| ----------------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| Persisted binding | The original attachment stored with the message                                   | Spill never mutates it                        |
| Wire copy         | The derived message payload sent to the model for one run                         | It is rebuilt from history                    |
| Spill             | Writing bytes into the session cwd and replacing the wire binding with a manifest | Requires a session cwd for copied bytes       |
| Manifest          | Raw model text containing a path, metadata, preview, and read instructions        | Binary manifests may contain no resource body |
| File handoff      | Representing a non-native model attachment as an agent-readable path              | Inspection still requires a compatible tool   |
| Path attachment   | A copy-free reference to a file that already exists on disk                       | Outside-cwd access remains permission-gated   |

## What you can do

| Module                              | Mechanism                                                                       | Boundary or failure mode                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `attachment-spill.ts`               | Materializes attachment bytes and returns text manifests                        | Without a session cwd, byte-backed attachments cannot be copied into the workspace |
| `history/stages/media.ts`           | Builds model-only assets, rehydrates native images, then invokes the spill pass | Persisted message bindings remain unchanged                                        |
| `packages/agent/src/chat.ts`        | Defines `spilled`, `path`, and `lineCount` on text attachments                  | The agent package does not perform filesystem I/O                                  |
| `packages/agent/src/agents/chat.ts` | Emits spilled manifests as raw text                                             | Omitting `spilled` would wrap the manifest in another attachment fence             |
| `run-teardown.ts`                   | Removes the owning session's spill directory after the run ends                 | Cleanup is best-effort and asynchronous                                            |

The invariant is that model history may contain a manifest or native model part, while the database
and UI retain the original binding.

## How it works

### Choose native carriage or file handoff

`buildModelHistory` derives asset bindings from each persisted message. It rehydrates only images
that the model wire carries natively when a session cwd exists, then passes all assets to
`spillMessageAttachments`.

| Attachment input                                          | Wire-copy result                                            | Boundary                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| PNG, JPEG, GIF, or WebP image                             | Native image part                                           | Other image formats use file handoff                         |
| Ordinary text attachment at or below both inline limits   | Fenced inline text                                          | Exceeding either limit spills it                             |
| Text above a limit                                        | Text manifest plus a file under the session spill directory | Manifest includes at most 50 preview lines                   |
| Byte-backed file, PDF, audio, video, or unsupported image | Copied file plus a text manifest                            | Native audio, video, and PDF parts are not used by this path |
| Textual byte-backed file                                  | Copied file plus bounded decoded preview                    | Invalid UTF-8 falls back to a binary manifest                |
| Extractable document                                      | Copied file plus extracted text preview                     | Requires the injected document extractor                     |
| Existing `path` attachment                                | Manifest pointing at the original path                      | The original file is not copied                              |

### Write deterministic paths

Copied and spilled bytes use this relative layout:

```text
.localix/attachments/<session-id>/<message-id>/<sanitized-file-name>
```

Duplicate names receive deterministic suffixes in attachment order. The implementation reserves
names before concurrent writes, so completion timing cannot change a manifest path.

Text spills write UTF-8 directly. File-backed attachments copy decoded `data` or the file resolved
from `mediaId`. Missing media-store files leave that attachment unchanged.

### Build the manifest

A text manifest names the path, detected extension, size, and known line count. It includes up to 50
leading lines and instructs the agent to call `read` with `start_line`, `end_line`, or `offset`.

Preview decoding reads at most 128 KiB. When only a prefix was decoded, the manifest omits a total
line count because the full count is unknown. A non-text attachment receives a binary manifest with
its path, media type, and size.

Path attachments outside the session cwd are not probed during materialization. Their manifest says
permission is required; the later file-tool call owns that permission boundary.

### Rebuild and clean up

The pass is idempotent for an attachment already marked `spilled`. When the run that still owns the
session ends, `teardownRun` removes `.localix/attachments/<session-id>` with a fire-and-forget
recursive delete. A later run rebuilds the files from persisted history.

Resolved message-context contributions enter model history as `contextRef: true` text assets. Large
ones pass through the same spill thresholds and manifest path as uploaded text.

## Configuration

These values are code constants, not user settings.

| Constant                       |       Value | Purpose                                                |
| ------------------------------ | ----------: | ------------------------------------------------------ |
| `MAX_INLINE_LINES`             | 2,000 lines | Maximum line count for inline text                     |
| `MAX_INLINE_BYTES`             |      50 KiB | Maximum UTF-8 size for inline text                     |
| `SPILL_PREVIEW_LINES`          |    50 lines | Maximum manifest head preview                          |
| `TEXT_PREVIEW_BYTES`           |     128 KiB | Maximum prefix decoded from an existing file           |
| `ATTACHMENT_SPILL_CONCURRENCY` |           4 | Concurrent writes, copies, and extractions per message |
| `MEDIA_CONCURRENCY`            |           4 | Concurrent media preparation across messages           |

## Limits

- Without `defaultCwd`, large text remains inline and byte-backed attachments are not copied into a
  session spill directory. Existing path attachments can still become path manifests.
- Only PNG, JPEG, GIF, and WebP use the native image path. PDF, audio, video, SVG, HEIC, BMP, and
  TIFF use file handoff in this subsystem.
- A binary manifest contains no extracted body. The agent must use a compatible file or mini app
  tool to inspect that resource.
- Document preview depends on the injected extractor. When extraction returns `null`, the attachment
  falls back to a textual or binary manifest.
- Spill cleanup is not awaited. A process crash or failed delete can leave files under the session's
  `.localix/attachments` directory.
- The spill directory is hidden from default ripgrep discovery. The manifest supplies the exact path
  so the agent can call `read` directly.

## Related guides

- [Message bindings](message-bindings.md)
- [Context system](context-system.md)
- [Context checkpoints](../../features/context-checkpoints.md)
- [Architecture](../architecture.md)

## Source of truth

- [Spill policy and manifests](../../../apps/api/src/features/chat/runtime/run/attachment-spill.ts)
- [Wire-copy integration](../../../apps/api/src/features/chat/runtime/history/stages/media.ts)
- [Teardown ownership](../../../apps/api/src/features/chat/runtime/run/run-teardown.ts)
- [Attachment type](../../../packages/agent/src/chat.ts) ·
  [API schema](../../../apps/api/src/features/chat/contracts/messages.ts)
- [Model serialization](../../../packages/agent/src/agents/chat.ts)
- [Composer staging](../../../apps/ui/src/shared/lib/attachments/file-staging.ts)
