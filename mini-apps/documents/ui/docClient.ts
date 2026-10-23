/**
 * Type barrel for the documents mini app's UI — re-exports the backend contract
 * types the viewers/clients consume, so UI code has ONE import site and never
 * reaches into backend module paths (mirrors the database mini app's dbClient.ts).
 */
export type {
  DocumentFormat,
  ExtractedDocument,
  ExtractOptions,
  ExtractResponse,
} from '../backend/documents/contracts'

export type {
  OpenTargetsResponse,
  OpenTargetView,
  TableMeta,
  TableRowsResponse,
} from '../backend/table/contracts'
