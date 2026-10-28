# Give the agent files and images

Use **Attach file**, drag files to the composer, or paste an image to include material with your
message. The attachment tray shows what is staged; remove a row before sending if it should not be
included. A file can be accepted even when the selected model cannot consume that format directly:
Localix can hand it to the agent as a file for its tools to read.

Staged attachments are transient and cleared when you switch sessions. Messages with attachments
sent during a run wait for a queued turn rather than steering the current response. A pasted text
longer than 4,000 characters becomes a `pasted-text.txt` attachment instead of filling the input.

## What the model receives

| Material                                       | Model-facing form                                                   | Boundary                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Short text                                     | Inline text                                                         | Larger or many-line text uses a file description and preview              |
| PNG, JPEG, GIF, WebP                           | An image part when the selected model supports images               | Acceptance is not a guarantee that a provider can analyze it              |
| PDF, DOCX, XLSX, PPTX, ODT                     | A workspace file with extracted text when an extractor is available | This is text extraction, not a full visual interpretation of every page   |
| Other images, audio, video, archives, binaries | A file path and description                                         | The agent needs appropriate tools or conversion to inspect the contents   |
| Desktop file path                              | A reference to the existing file                                    | It is not a snapshot; availability and contents can change before the run |

Unsupported image/audio modalities remain attachable as files. Unknown model modality metadata is
permissive in the picker, so an eventual provider rejection is still possible. PDF attachment does
not require native PDF support from the model. Missing extraction support leaves a binary-file
description; it does not manufacture document text.

## Uploaded bytes and original paths

Browser files are read inline when small or uploaded to the API's content-addressed media store when
larger. Stored message bindings retain the attachment metadata and media ID; model requests
rehydrate supported bytes as needed. The media store sits beside the configured Localix database.
These uploaded copies persist independently of the browser's original file.

Removing an item from the tray, or clearing the staged list, removes it from the composer. It does
not delete an already uploaded media copy or the original file on disk.

When the desktop can recover an absolute dropped-file path, it can retain that path instead of
uploading another copy. The path must exist on the API host. Moving or deleting the original can
make it unavailable, and later edits can change what the agent reads. A readable supported image up
to 5 MiB can be carried directly even outside the workspace. Other outside-workspace paths are not
read automatically; the agent receives a path description and later file-tool access follows normal
permission rules.

Large text and binary uploads are materialized under `.localix/attachments/<session>/<message>/`
inside the session workspace. The stored transcript keeps its attachment; this rewrite changes only
the model-facing copy. The description names the file and offers a bounded preview so the agent can
request the relevant remainder through `Read`. This workspace directory is internal material, not a
directory to commit to your repository.

## Limits

| Boundary                      | Current behavior                                                             |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Raw media upload              | At most 128 MiB per request; a smaller proxy limit can reject it earlier     |
| Browser file staging          | Files at or above 50 KiB use the media-upload path                           |
| Inline text on the model wire | Text over 50 KiB or 2,000 lines is spilled to a workspace file               |
| File preview read from disk   | First 50 lines, from at most 128 KiB of decoded text                         |
| PNG/JPEG model copy           | Large images are reduced to a 1,568-pixel long edge; originals remain stored |

The raw upload limit does not mean a message containing many files can carry unlimited bytes. Other
API requests have the same body ceiling, and the model request has its own context budget. GIF/WebP
and other unsupported resize formats do not use the PNG/JPEG downscale path. Failed image decoding
leaves the original image bytes. `LOCALIX_DISABLE_IMAGE_DOWNSCALE` disables model-copy resizing on
the server.

Legacy inline-text spills also keep the first 50 lines, but have no separate preview byte cap; a
very long line can still consume substantial context. A preview can omit later sections, spreadsheet
cells, layout, embedded images, or other content. Ask the agent to read or inspect the relevant
material before relying on a whole-document claim. Binary handoff does not add a decoder for every
format. With no resolved workspace, the runtime cannot perform normal spill-to-disk handoff.
Uploads, spill copies, and originals follow different storage lifetimes; see the privacy guide
before sharing or deleting data.

## When a file fails to attach

Files in one selection are processed independently, so an unreadable file or failed upload does not
discard the successful attachments. The interface reports rejected files. A read/upload failure also
stages a text item named `<filename> (attachment error).txt` that explains the failure to the agent
if you send it; the original bytes were not attached. Review or remove that note in the tray before
sending. An explicit picker-policy refusal can reject a file without adding a note.

A sendable message or an error note is not proof that the agent can inspect the missing file.
Resolve the read or upload failure and attach the file again when its contents are needed. Native
path staging also skips the browser upload-size check; later access still depends on the file being
readable on the API host and the relevant runtime limits.

## Related guides

- [Your first session](../getting-started/first-session.md)
- [Workspace context](workspace.md)
- [Context checkpoints](context-checkpoints.md)
- [Permissions](permissions.md)
- [Privacy and local storage](../getting-started/privacy.md)

## Source of truth

- [Composer modality policy](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/attachment-policy.ts)
- [File staging](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/attachments/file-staging.ts)
- [Staged attachment removal](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/lib/attachments/useComposerAttachments.ts)
- [Raw media upload limit](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/api/media-client.ts)
- [Persisted media bindings](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/media/attachments.ts)
- [Spill handoff](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/attachment-spill.ts)
- [Original-path attachments](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/attachment-path.ts)
- [Preview bounds](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/attachment-manifests.ts)
- [Image resizing](https://github.com/rsaryev/localix/blob/main/packages/agent/src/images/downscale.ts)
