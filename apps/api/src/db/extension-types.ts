/** Registry metadata stays separate from every contributed native definition. */
export interface ExtensionContributionTable {
  id: string
  source_id: string
  user_id: string
  project_id: string
  kind: string
  contribution_key: string
  payload: string
  position: number
  revision: number
  active: number
  created_at: string
  updated_at: string
}
