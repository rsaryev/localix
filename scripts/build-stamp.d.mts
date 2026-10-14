export const BUILD_STAMP_ENV: 'LOCALIX_BUILD_STAMP'

export const RELEASE_STAMPED_FILES: readonly string[]

export interface ResolveBuildStampOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  git?: (args: string[], cwd?: string) => string
}

export function resolveBuildStamp(options?: ResolveBuildStampOptions): string
