import type { ExecuteModelTaskOptions, ModelTaskOutcome, ModelTaskRequest } from './contracts'

/**
 * Runs a provider-neutral model task under caller cancellation and a host deadline.
 * Provider errors intentionally lose their details here: callers may record only the
 * typed outcome and must keep task prompts and response bodies out of telemetry.
 */
export function executeModelTask<Input, Output>(
  options: ExecuteModelTaskOptions<Input, Output>,
): Promise<ModelTaskOutcome<Output>> {
  const { request, execute } = options
  return new Promise((resolve) => {
    const deadlineExceeded = () =>
      request.deadlineAtMs !== undefined && Date.now() >= request.deadlineAtMs
    if (request.signal?.aborted || deadlineExceeded()) {
      resolve({ status: deadlineExceeded() ? 'deadline_exceeded' : 'cancelled' })
      return
    }

    const controller = new AbortController()
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (outcome: ModelTaskOutcome<Output>) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      request.signal?.removeEventListener('abort', onCallerAbort)
      resolve(outcome)
    }
    const abortedOutcome = (): ModelTaskOutcome<Output> => ({
      status: deadlineExceeded() ? 'deadline_exceeded' : 'cancelled',
    })
    const onCallerAbort = () => {
      controller.abort()
      finish(abortedOutcome())
    }

    request.signal?.addEventListener('abort', onCallerAbort, { once: true })
    if (request.deadlineAtMs !== undefined) {
      timer = setTimeout(
        () => {
          controller.abort()
          finish({ status: 'deadline_exceeded' })
        },
        Math.max(0, request.deadlineAtMs - Date.now()),
      )
    }

    const providerRequest: Omit<ModelTaskRequest<Input>, 'signal'> = {
      task: request.task,
      system: request.system,
      input: request.input,
      budget: request.budget,
      capabilities: request.capabilities,
      ...(request.deadlineAtMs !== undefined ? { deadlineAtMs: request.deadlineAtMs } : {}),
    }
    // A provider adapter is typed as async, but a buggy/plugin adapter can still
    // throw before producing its Promise. Keep that inside the same normalized
    // outcome contract instead of letting the runtime Promise reject unexpectedly.
    let providerCall: ReturnType<typeof execute>
    try {
      providerCall = execute(providerRequest, controller.signal)
    } catch {
      finish({ status: 'provider_error' })
      return
    }

    const finishProviderCall = (
      outcome:
        | { status: 'success'; response: Awaited<typeof providerCall> }
        | { status: 'provider_error' },
    ) => {
      // Timers are tasks; resolved Promises are microtasks. If the event loop was
      // blocked across the deadline, the provider continuation can run before the
      // deadline timer. Re-check wall time here so a late response is never accepted.
      if (deadlineExceeded()) {
        controller.abort()
        finish({ status: 'deadline_exceeded' })
        return
      }
      finish(controller.signal.aborted ? abortedOutcome() : outcome)
    }
    void providerCall.then(
      (response) => finishProviderCall({ status: 'success', response }),
      () => finishProviderCall({ status: 'provider_error' }),
    )
  })
}
