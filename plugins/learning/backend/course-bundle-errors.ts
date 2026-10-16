export interface CourseBundleDiagnostic {
  code:
    | 'invalid-root'
    | 'invalid-json'
    | 'invalid-manifest'
    | 'invalid-reference'
    | 'missing-reference'
    | 'invalid-content'
    | 'duplicate-id'
    | 'invalid-progression'
  file: string
  field?: string
  message: string
  fix: string
}

export class CourseBundleValidationError extends Error {
  readonly diagnostic: CourseBundleDiagnostic

  constructor(diagnostic: CourseBundleDiagnostic, options?: ErrorOptions) {
    super(`${diagnostic.file}: ${diagnostic.message}`, options)
    this.name = 'CourseBundleValidationError'
    this.diagnostic = diagnostic
  }
}

export function validationError(
  diagnostic: CourseBundleDiagnostic,
  cause?: unknown,
): CourseBundleValidationError {
  return new CourseBundleValidationError(diagnostic, cause === undefined ? undefined : { cause })
}

export function formatCourseBundleError(error: unknown): string {
  if (!(error instanceof CourseBundleValidationError)) {
    return [
      'Course validation failed.',
      `Issue: ${error instanceof Error ? error.message : String(error)}`,
      'Fix: inspect the referenced course files, patch only the failing file, then activate the same course.json again.',
    ].join('\n')
  }
  const { diagnostic } = error
  return [
    'Course validation failed.',
    `Code: ${diagnostic.code}`,
    `File: ${diagnostic.file}`,
    ...(diagnostic.field ? [`Field: ${diagnostic.field}`] : []),
    `Issue: ${diagnostic.message}`,
    `Fix: ${diagnostic.fix}`,
    'Retry: patch this file and call learning_course activate with the same root course.json.',
  ].join('\n')
}
