import type { AgentRunError } from './errors'
import type { AgentErrorInfo } from './error-classification-contracts'

export function agentRunErrorToInfo(error: AgentRunError): AgentErrorInfo {
  switch (error.code) {
    case 'AGENT_UNAVAILABLE':
      return { kind: 'fatal', userMessage: error.message, retryable: false }
    case 'NO_PROVIDER_CONNECTION':
      // With a reason, the host composed the sentence from facts only it has (the model id, the
      // provider's name); without one, the generic sentence is all that can honestly be said.
      return error.reason
        ? {
            kind: 'fatal',
            userMessage: error.message,
            retryable: false,
            modelUnavailable: error.reason,
          }
        : {
            kind: 'fatal',
            userMessage: 'No provider connection selected. Choose a connection first.',
            retryable: false,
          }
    case 'NO_MODEL':
      return {
        kind: 'fatal',
        userMessage: 'No model selected. Choose a model first.',
        retryable: false,
      }
    case 'PROVIDER_AUTH_FAILED':
      return {
        kind: 'fatal',
        userMessage: 'Authentication failed. Check your API key.',
        retryable: false,
        authFailed: true,
      }
    case 'PROVIDER_INSUFFICIENT_CREDITS':
      return {
        kind: 'fatal',
        userMessage: 'Insufficient credits. Top up your account.',
        retryable: false,
        rateLimited: true,
      }
    case 'PROVIDER_ACCESS_DENIED':
      return {
        kind: 'fatal',
        userMessage: 'Access denied. Your API key may not have permission for this model.',
        retryable: false,
      }
    case 'PROVIDER_NOT_FOUND':
      return {
        kind: 'fatal',
        userMessage: 'Model not found. The selected model may not be available.',
        retryable: false,
      }
    case 'PROVIDER_RATE_LIMITED':
      return {
        kind: 'fatal',
        userMessage: 'Rate limit exceeded. Please wait a moment and try again.',
        retryable: true,
        rateLimited: true,
      }
    case 'PROVIDER_UNAVAILABLE':
      return {
        kind: 'fatal',
        userMessage: 'Provider unavailable. Try again in a moment.',
        retryable: true,
      }
    case 'PROVIDER_TIMEOUT':
      return {
        kind: 'fatal',
        userMessage: 'Request timed out. The provider took too long to respond.',
        retryable: true,
      }
    case 'ABORTED':
      return { kind: 'abort', userMessage: 'Cancelled', retryable: false }
    case 'HITL_DISMISSED':
      return { kind: 'dismissed', userMessage: 'Interaction cancelled', retryable: true }
    case 'HITL_TIMEOUT':
      return {
        kind: 'timeout',
        userMessage: 'The request expired before a response was provided.',
        retryable: true,
      }
  }
}
