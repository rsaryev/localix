# Native data view internals

Native data view is the read-only spreadsheet pipeline owned by the Documents mini app. It turns a
CSV or workbook file into a restorable, paged table or chart without adding a model-facing tool.

## Boundaries

| Owner                 | Responsibility                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@localixai/dataview` | Pure column models, parsing, row queries, chart specs, formatting, and exporter contracts.                                           |
| Documents backend     | Spreadsheet extraction, persistence of its own, paging, CSV/XLSX export, and native-file intents.                                    |
| Documents UI          | File editor, table/chart rendering, filtering, sorting, download, and resource context.                                              |
| Host                  | Supplies user/session scope, mini app data directories, session artifact storage, and desktop file actions through the mini app SDK. |

Core does not import the Documents mini app and owns no table tool or table event. Opening a
spreadsheet invokes the mini app's `/rpc/table/ingest` route; the file editor keeps the resulting id
and requests metadata and rows from the same mini app routes.

## Flow

1. The Documents file association selects `TableFileTab` for CSV or workbook content.
2. The UI sends an absolute path or media id plus the current session id to `/rpc/table/ingest`.
3. The extraction service returns typed columns and rows.
4. `createTableStore` writes the rows payload before the metadata payload under the mini app data
   directory.
5. The table tab requests bounded pages and renders either a virtualized grid or a chart.
6. Export and “open with” reuse the exporter registry. Temporary files go through the host's
   session-storage and desktop-file ports; the mini app never imports host internals.

Every read checks the table id and `userId`. Row and metadata caches are bounded; eviction causes a
disk read and does not delete persisted data. Filtering and sorting currently operate over the full
stored row array before slicing the requested page.

## Limits

- Spreadsheet views are read-only and never modify the source file.
- Client paging bounds transfer and rendering, not backend memory: persisted rows are JSON arrays.
- Chart loading stops at 4,000 rows.
- Native opening acts on the API host and is unavailable when the host does not expose file intents.

## Source of truth

- [Data-view package](../../../packages/dataview/src/model.ts)
- [Table store](../../../mini-apps/documents/backend/table/store.ts)
- [Table service](../../../mini-apps/documents/backend/table/service.ts)
- [Table routes](../../../mini-apps/documents/backend/table/routes.ts)
- [Spreadsheet file tab](../../../mini-apps/documents/ui/TableFileTab.tsx)
- [Table tab](../../../mini-apps/documents/ui/table/TableTab.tsx)
