export interface InsoPair {
  name?: string
  value?: string
  disabled?: boolean
}

export interface InsoResource {
  _id?: string
  _type?: string
  parentId?: string | null
  name?: string
  url?: string
  method?: string
  headers?: InsoPair[]
  parameters?: InsoPair[]
  pathParameters?: { name?: string; value?: string }[]
  body?: { mimeType?: string | null; text?: string; params?: InsoPair[] } | string
  authentication?: Record<string, unknown>
  /** request_group / workspace only. */
  environment?: Record<string, unknown>
  /** environment resources. */
  data?: Record<string, unknown>
}

export interface InsoExport {
  __export_format?: number
  resources?: InsoResource[]
}
