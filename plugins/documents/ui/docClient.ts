/**
 * Type barrel for the documents plugin's UI — re-exports the backend contract
 * types the viewers/clients consume, so UI code has ONE import site and never
 * reaches into backend module paths (mirrors the database plugin's dbClient.ts).
 */
export type {
  DocumentConverter,
  DocumentFormat,
  DocumentInput,
  DocumentKind,
  DocumentMetadata,
  ExtractedDocument,
  ExtractedTableDocument,
  ExtractedTextDocument,
  ExtractOptions,
  ExtractRequest,
  ExtractResponse,
} from '../backend/documents/contracts'
export type {
  DocumentGenerator,
  GeneratedDocument,
  GenerateFormat,
  GenerateInput,
  GenerateRequest,
  GenerateResponse,
} from '../backend/documents/generate-contracts'
export { GENERATE_FORMATS } from '../backend/documents/generate-contracts'
export type { DocumentErrorCode, DocumentErrorInfo } from '../backend/documents/errors'
export type {
  OpenTargetsResponse,
  OpenTargetView,
  TableMeta,
  TableRowsResponse,
} from '../backend/table/contracts'
