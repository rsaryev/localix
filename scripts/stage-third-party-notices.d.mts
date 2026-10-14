export interface StageThirdPartyNoticesOptions {
  repoRoot: string
  destination: string
  target?: 'product' | 'landing'
  /** Adds the Bun runtime and the native shell's Rust crates to a desktop build's notices. */
  desktop?: { targetTriple?: string; metadata?: unknown }
}

export interface RuntimeNoticePackage {
  name: string
  version: string
  license?: string
  packageRoot: string
  notices: string[]
}

export function stageThirdPartyNotices(options: StageThirdPartyNoticesOptions): void

export function collectRuntimeNoticePackages(
  options: Pick<StageThirdPartyNoticesOptions, 'repoRoot' | 'target'>,
): RuntimeNoticePackage[]

export function buildRuntimeNotices(
  options: Pick<StageThirdPartyNoticesOptions, 'repoRoot' | 'target'>,
): string

export const STAGED_THIRD_PARTY_NOTICE_FILES: readonly string[]

export const STAGED_DESKTOP_NOTICE_FILES: readonly string[]
