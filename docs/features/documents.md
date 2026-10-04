# Documents

The bundled Documents plugin supplies read-only viewers and extraction for office files, PDFs, CSV,
and workbooks. It is enabled by default and can be disabled independently of core.

## Capabilities

| Capability                 | Mechanism                                                                                  | Boundary                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Read binary documents      | The plugin implements the standard `document.extract` SDK port used by core `read`.        | When the plugin is disabled, core reports its normal unsupported-binary result. |
| View PDFs and office files | Plugin file associations select PDF, Markdown, or table viewers.                           | Viewers do not edit the source.                                                 |
| Inspect spreadsheets       | CSV and workbook files are ingested into the plugin's paged table pipeline.                | Sort, filter, chart, and export operate on a plugin-owned copy.                 |
| Mention extracted content  | `localix://resource/doc/<cache-id>` expands a bounded cached extraction.                   | The resource contains extracted text/rows, not the original binary.             |
| Generate via HTTP          | `/rpc/documents/generate` produces DOCX, PDF, or XLSX and may store it through host media. | This is an application route, not an agent tool.                                |

The plugin contributes no model-facing tools. Agents use the generic core `read`, `write`, and shell
capabilities; the plugin augments `read` through a typed extension port.

## Supported extraction

| Input                      | Result                          |
| -------------------------- | ------------------------------- |
| DOCX, ODT                  | Markdown                        |
| DOC                        | Plain text                      |
| PPTX                       | Markdown with slide structure   |
| PDF                        | Extracted Markdown text; no OCR |
| XLSX, XLS, XLSM, XLSB, CSV | Typed columns and rows          |
| Markdown formats           | Verbatim UTF-8 text             |

Extraction rejects inputs over 25 MiB, caps Markdown at 1,500,000 characters, and caps tables at
10,000 rows. Core `read` delegates the supported binary formats through the capability registry; CSV
and Markdown continue through normal text reading unless opened in the Documents viewer.

## Architecture

Registration returns generic `BackendSubsystem` contributions from the plugin SDK:

- `/rpc/documents`, the `document.extract` capability, and the document resource provider;
- `/rpc/table`, which owns spreadsheet ingestion, paging, export, and native opening.

The host injects `userId`, `dataDir`, media access, session storage, and desktop file intents
through `PluginContext`. The plugin never imports `apps/api` internals or computes host storage
paths.

## Related guides

- [Documents internals](https://github.com/rsaryev/localix/blob/main/docs/internals/subsystems/documents.md)
- [Native data view internals](https://github.com/rsaryev/localix/blob/main/docs/internals/subsystems/data-view.md)
- [Plugins](../extending/plugins.md)
