import pDefer from 'p-defer'

export type HumanInLoopRequestKind = 'ask' | (string & {})

export interface HumanInLoopRequestBase<
  TKind extends HumanInLoopRequestKind = HumanInLoopRequestKind,
  TPayload = unknown,
> {
  id: string
  kind: TKind
  title?: string
  payload: TPayload
  createdAt: number
  expiresAt?: number
}

export interface HumanInLoopResponseBase<
  TKind extends HumanInLoopRequestKind = HumanInLoopRequestKind,
  TPayload = unknown,
> {
  requestId: string
  kind: TKind
  payload: TPayload
  respondedAt: number
}

export interface HumanInLoopPendingRequest<
  TRequest extends HumanInLoopRequestBase = HumanInLoopRequestBase,
  TResponse extends HumanInLoopResponseBase = HumanInLoopResponseBase,
> {
  request: TRequest
  resolve(response: TResponse): void
  reject(error: Error): void
}

export type HumanInLoopRecordStatus =
  | 'pending'
  | 'responded'
  | 'rejected'
  | 'expired'
  | 'aborted'
  | 'dismissed'

export interface HumanInLoopRecord<
  TRequest extends HumanInLoopRequestBase = HumanInLoopRequestBase,
  TResponse extends HumanInLoopResponseBase = HumanInLoopResponseBase,
> {
  request: TRequest
  status: HumanInLoopRecordStatus
  response?: TResponse
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

export interface HumanInLoopStore {
  put(record: HumanInLoopRecord): void | Promise<void>
  update(record: HumanInLoopRecord): void | Promise<void>
  get?(requestId: string): HumanInLoopRecord | undefined | Promise<HumanInLoopRecord | undefined>
  list?(): HumanInLoopRecord[] | Promise<HumanInLoopRecord[]>
}

export interface CreateHumanInLoopControllerOptions {
  store?: HumanInLoopStore
  now?: () => number
  /** Completed records retained in process memory. Pending requests are never evicted. */
  maxRetainedRecords?: number
}

export const DEFAULT_MAX_RETAINED_HITL_RECORDS = 512

export interface HumanInLoopController {
  request<TRequest extends HumanInLoopRequestBase, TResponse extends HumanInLoopResponseBase>(
    request: TRequest,
    signal?: AbortSignal,
  ): Promise<TResponse>
  respond<TResponse extends HumanInLoopResponseBase>(response: TResponse): boolean
  reject(requestId: string, error: Error): boolean
  getPending(requestId: string): HumanInLoopPendingRequest | undefined
  listPending(): HumanInLoopPendingRequest[]
  getRecord(requestId: string): HumanInLoopRecord | undefined
  listRecords(): HumanInLoopRecord[]
}

export class HumanInLoopError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanInLoopError'
  }
}

export class HumanInLoopAbortError extends HumanInLoopError {
  constructor(message = 'Human-in-loop request was aborted') {
    super(message)
    this.name = 'HumanInLoopAbortError'
  }
}

export class HumanInLoopTimeoutError extends HumanInLoopError {
  constructor(message = 'Human-in-loop request expired') {
    super(message)
    this.name = 'HumanInLoopTimeoutError'
  }
}

export class HumanInLoopDismissedError extends HumanInLoopError {
  constructor(message = 'Human-in-loop request was dismissed') {
    super(message)
    this.name = 'HumanInLoopDismissedError'
  }
}

function reportStoreFailure(error: unknown): void {
  console.warn('[human-in-loop] record store write failed', error)
}

export function createHumanInLoopController(
  options: CreateHumanInLoopControllerOptions = {},
): HumanInLoopController {
  const maxRetainedRecords = options.maxRetainedRecords ?? DEFAULT_MAX_RETAINED_HITL_RECORDS
  if (!Number.isSafeInteger(maxRetainedRecords) || maxRetainedRecords < 0) {
    throw new RangeError('maxRetainedRecords must be a non-negative safe integer')
  }
  const pending = new Map<string, HumanInLoopPendingRequest>()
  const records = new Map<string, HumanInLoopRecord>()
  // Completion-order queue for bounded local history. The main records map keeps
  // creation order for listRecords(), while this set lets us evict in O(1).
  const completedRecordIds = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const now = options.now ?? (() => Date.now())

  const writeRecord = (record: HumanInLoopRecord, mode: 'put' | 'update') => {
    records.set(record.request.id, record)
    completedRecordIds.delete(record.request.id)
    if (record.status !== 'pending') {
      completedRecordIds.add(record.request.id)
      while (completedRecordIds.size > maxRetainedRecords) {
        const oldest = completedRecordIds.values().next().value
        if (oldest === undefined) break
        completedRecordIds.delete(oldest)
        records.delete(oldest)
      }
    }
    // A failing store must not surface as an unhandled rejection: the in-memory record
    // stays authoritative for the live request.
    try {
      if (options.store) Promise.resolve(options.store[mode](record)).catch(reportStoreFailure)
    } catch (error) {
      reportStoreFailure(error)
    }
  }

  const cleanup = (requestId: string, signal?: AbortSignal, onAbort?: () => void) => {
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    const timer = timers.get(requestId)
    if (timer) clearTimeout(timer)
    timers.delete(requestId)
    pending.delete(requestId)
  }

  const settleRejected = (
    requestId: string,
    status: 'rejected' | 'expired' | 'aborted' | 'dismissed',
    error: Error,
  ) => {
    const record = records.get(requestId)
    if (record) {
      writeRecord(
        {
          ...record,
          status,
          errorMessage: error.message,
          updatedAt: now(),
        },
        'update',
      )
    }
  }

  return {
    request: <TRequest extends HumanInLoopRequestBase, TResponse extends HumanInLoopResponseBase>(
      request: TRequest,
      signal?: AbortSignal,
    ) => {
      if (pending.has(request.id)) {
        return Promise.reject(
          new HumanInLoopError(`Human-in-loop request "${request.id}" is already pending`),
        )
      }

      if (signal?.aborted) {
        return Promise.reject(new HumanInLoopAbortError())
      }

      const deferred = pDefer<TResponse>()
      const createdAt = request.createdAt || now()
      const normalizedRequest = { ...request, createdAt }
      const record: HumanInLoopRecord<TRequest, TResponse> = {
        request: normalizedRequest,
        status: 'pending',
        createdAt,
        updatedAt: createdAt,
      }

      const onAbort = () => {
        const error = new HumanInLoopAbortError()
        cleanup(request.id, signal, onAbort)
        settleRejected(request.id, 'aborted', error)
        deferred.reject(error)
      }

      const entry: HumanInLoopPendingRequest<TRequest, TResponse> = {
        request: normalizedRequest,
        resolve: (response) => {
          cleanup(request.id, signal, onAbort)
          writeRecord(
            {
              ...record,
              status: 'responded',
              response,
              updatedAt: response.respondedAt || now(),
            },
            'update',
          )
          deferred.resolve(response)
        },
        reject: (error) => {
          cleanup(request.id, signal, onAbort)
          settleRejected(
            request.id,
            error instanceof HumanInLoopDismissedError ? 'dismissed' : 'rejected',
            error,
          )
          deferred.reject(error)
        },
      }

      if (normalizedRequest.expiresAt && normalizedRequest.expiresAt <= now()) {
        // Already expired at request time. Persist the record first so it lands in
        // the store as put→expired, exactly like the async-timer path — otherwise
        // settleRejected (which reads an existing record) would no-op and the store
        // would never see this request at all. Settled before the abort listener is
        // attached: a later abort must not rewrite the record or reject a deferred
        // nobody awaits.
        const error = new HumanInLoopTimeoutError()
        writeRecord(record as HumanInLoopRecord, 'put')
        settleRejected(normalizedRequest.id, 'expired', error)
        return Promise.reject(error)
      }

      signal?.addEventListener('abort', onAbort, { once: true })
      if (normalizedRequest.expiresAt) {
        timers.set(
          normalizedRequest.id,
          setTimeout(() => {
            const error = new HumanInLoopTimeoutError()
            cleanup(normalizedRequest.id, signal, onAbort)
            settleRejected(normalizedRequest.id, 'expired', error)
            deferred.reject(error)
          }, normalizedRequest.expiresAt - now()),
        )
      }

      pending.set(request.id, entry as HumanInLoopPendingRequest)
      writeRecord(record as HumanInLoopRecord, 'put')
      return deferred.promise
    },
    respond: (response) => {
      const entry = pending.get(response.requestId)
      if (!entry) return false
      if (entry.request.kind !== response.kind) return false
      entry.resolve(response)
      return true
    },
    reject: (requestId, error) => {
      const entry = pending.get(requestId)
      if (!entry) return false
      entry.reject(error)
      return true
    },
    getPending: (requestId) => pending.get(requestId),
    listPending: () => [...pending.values()],
    getRecord: (requestId) => records.get(requestId),
    listRecords: () => [...records.values()],
  }
}
