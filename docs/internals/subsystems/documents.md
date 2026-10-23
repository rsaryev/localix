# Documents plugin internals

The Documents plugin owns binary-document extraction, generation routes, read-only viewers,
spreadsheet data views, and document resource references.

## Composition boundary

The plugin registers two SDK `BackendSubsystem` values:

| Contribution | Surface                                                                |
| ------------ | ---------------------------------------------------------------------- |
| `documents`  | `/rpc/documents`, `document.extract`, and `localix://resource/doc`     |
| `table`      | `/rpc/table` spreadsheet ingestion, paging, export, and native opening |

It contributes no agent tools. Core consumes only the capability-shaped `DocumentExtractPort`; it
does not import the plugin, know its routes, or own a plugin-specific adapter. The host injects
generic media, data-directory, session-storage, desktop-file, user, and request-scope services via
the plugin SDK.

## Extraction pipeline

The service accepts an absolute path or a host media id, enforces the byte limit before parsing,
detects a format, and hashes the bytes with extraction-affecting options. Cache hits return the
content-addressed result; cache misses lazily load the selected driver and persist JSON under the
plugin data directory.

| Input family          | Driver result                         | Important boundary                                 |
| --------------------- | ------------------------------------- | -------------------------------------------------- |
| DOCX                  | Markdown via semantic HTML conversion | Embedded-image-only content may be empty.          |
| DOC                   | Plain text                            | Rich document structure is not retained.           |
| PPTX, ODT             | Parsed Markdown                       | Slide filtering is best effort.                    |
| PDF                   | Extracted Markdown                    | No OCR is configured.                              |
| XLSX, XLS, XLSM, XLSB | Typed columns and rows                | A sheet selector may fall back to the first sheet. |
| CSV                   | Inferred typed columns and rows       | The complete file is parsed before windowing.      |
| Markdown              | Verbatim UTF-8 text                   | It remains on the text path.                       |

Successful extractions update the plugin's bounded recents index. The resource provider expands the
same cached result that core `read` receives through `document.extract`, so model and UI views do
not derive separate content.

## Generation and viewers

`POST /rpc/documents/generate` produces DOCX, PDF, or XLSX bytes. When host media is present, the
route persists those bytes through the media port. File viewers are registered from the plugin
manifest/UI contribution: PDFs use a browser-native view, office formats render extracted Markdown,
and spreadsheets enter the table pipeline described in [Native data view internals](data-view.md).

## Invariants

| Owner              | Invariant                                                                        |
| ------------------ | -------------------------------------------------------------------------------- |
| Host               | Supplies identity and storage paths; plugins never read host env/path policy.    |
| SDK                | Owns extension contracts and generic host-service ports.                         |
| Extraction service | Cache keys include every driver-affecting option.                                |
| Store              | Cache ids are 64 lowercase hex characters plus `.json`.                          |
| Table store        | Writes rows before metadata and checks `userId` on every read.                   |
| Plugin host        | Disabling the plugin unregisters its routes, providers, and capability together. |

## Limits

- Input: 25 MiB.
- Extracted Markdown: 1,500,000 characters.
- Extracted table: 10,000 rows.
- Recent-document index: 50 entries.
- Path-backed PDF preview: 30,000,000 bytes.

## Source of truth

- [Plugin registration](../../../mini-apps/documents/backend/index.ts)
- [Extraction service](../../../mini-apps/documents/backend/documents/service.ts)
- [Capability adapter](../../../mini-apps/documents/backend/extract-port.ts)
- [Documents routes](../../../mini-apps/documents/backend/documents/routes.ts)
- [Table service](../../../mini-apps/documents/backend/table/service.ts)
- [UI registration](../../../mini-apps/documents/ui/register.tsx)
