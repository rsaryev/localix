import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { documentSchema, type ResumeDocument } from '../shared/schema'

export type FieldErrors = Record<string, string>
const ValidationContext = createContext({ errors: {} as FieldErrors, prefix: '' })
export function documentErrors(document: ResumeDocument): FieldErrors {
  const parsed = documentSchema.safeParse(document)
  if (parsed.success) return {}
  const errors: FieldErrors = {}
  for (const issue of parsed.error.issues) errors[issue.path.join('.')] ??= issue.message
  return errors
}
export function ValidationScope({
  prefix = '',
  errors,
  children,
}: {
  prefix?: string
  errors?: FieldErrors
  children: ReactNode
}) {
  const parent = useContext(ValidationContext)
  const value = useMemo(
    () => ({
      errors: errors ?? parent.errors,
      prefix: [parent.prefix, prefix].filter(Boolean).join('.'),
    }),
    [errors, parent, prefix],
  )
  return <ValidationContext.Provider value={value}>{children}</ValidationContext.Provider>
}
export function useFieldError(field: string | undefined): string | undefined {
  const { errors, prefix } = useContext(ValidationContext)
  return field === undefined ? undefined : errors[[prefix, field].filter(Boolean).join('.')]
}
