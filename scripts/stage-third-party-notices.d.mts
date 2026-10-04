export interface StageThirdPartyNoticesOptions {
  repoRoot: string
  destination: string
  target?: 'product' | 'landing'
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
