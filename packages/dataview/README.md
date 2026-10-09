# `@localixai/dataview`

`@localixai/dataview` is the dependency-free table-data contract shared across Localix. It owns
typed models and pure transforms for tabular data, not rendering, persistence, or host I/O.

## Consumers

Extensions use the package for persisted spreadsheet and query-result views; the UI uses its models,
formatting, queries, and chart specifications. Extension-owned adapters may add table storage,
paging, export, native-open operations, or adapt query results to the same filtering, sorting,
coercion, and chart contracts.

## Entry points

| Entry point           | Contract                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@localixai/dataview` | Exports table models and cell helpers; CSV, TSV, and JSON parsing; sort, filter, and page operations; table summaries; chart specifications; exporter registries; CSV serialization; XLSX metadata; and native-open target data. |

Only the package root is exported. Source-file paths are not public subpath entry points.

## Limits

- Chart exports are specifications and validation helpers only; a host supplies the renderer.
- Parsing and query operations run over in-memory text and row arrays. Column inference samples at
  most the first 200 rows.
- CSV serialization is implemented here. The default XLSX exporter declares its id, label, media
  type, and extension, but its serializer throws until a host registers a workbook encoder under the
  same id.
- Native-open targets are catalog data. The host is responsible for detecting installed
  applications, writing exported files, and launching or revealing them.

## Source of truth

- [Root exports](src/index.ts)
- [Table model](src/model.ts)
- [Parsing](src/parse.ts)
- [Queries](src/query.ts)
- [Charts](src/chart.ts)
- [Export registry](src/export/registry.ts)
- [Open-target catalog](src/open/targets.ts)
