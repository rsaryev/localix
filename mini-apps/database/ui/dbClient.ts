/**
 * The database workbench UI's type surface. The mini app owns its backend and UI, so these types
 * are imported from the mini app's backend modules. One barrel keeps every UI import uniform and
 * depth-independent (`../dbClient`).
 */
export type {
  DbConnectionConfig,
  DbSslConfig,
  ConnectionColor,
  SshTunnelConfig,
  ConnectRequest,
  UpdateConfigRequest,
  SavedConnectionConfigResponse,
  BrowseRequest,
  BatchRequest,
  DbConnectionInfo,
  QueryResponse,
  BrowseResponse,
  BatchResponse,
  CancelResponse,
  PingResponse,
  ValidateResponse,
} from '../backend/contracts'
// VALUE re-export from the zod-free colors leaf — NOT from contracts, whose top-level
// schema construction would otherwise ride the eager SPA graph via connectionColor.ts.
export { CONNECTION_COLORS } from '../backend/colors'
export type { DbErrorCode } from '../backend/errors'
export type {
  DbDialect,
  DbColumn,
  DbIndex,
  DbTableSchema,
  DbCatalogColumn,
  DbColumnCatalog,
  DbSchemaItem,
  DbSchemas,
  DbResultSet,
} from '../backend/drivers/port'
