import {
  BadgeCheck,
  BookUser,
  ContactRound,
  CreditCard,
  Database,
  FileLock2,
  Fingerprint,
  Gift,
  HeartPulse,
  IdCard,
  KeyRound,
  Landmark,
  LifeBuoy,
  LockKeyhole,
  LogIn,
  MailCheck,
  NotebookPen,
  PackageCheck,
  ServerCog,
  ShieldCheck,
  SquareTerminal,
  TentTree,
  TicketCheck,
  TimerReset,
  Vault,
  WalletCards,
  Wifi,
  type LucideIcon,
} from 'lucide-react'

import type { VaultItemType } from '@localixai/api/client'

export type VaultTypeTone = 'neutral' | 'accent' | 'info' | 'warning'

export interface VaultTypePresentation {
  Icon: LucideIcon
  tone: VaultTypeTone
}

/**
 * One monochrome icon vocabulary for every Vault surface.
 *
 * Lucide icons are local SVG components: no remote favicon lookup, no item URL
 * disclosure, and no colored brand artwork competing with Localix's UI language.
 */
export const VAULT_TYPE_PRESENTATION: Record<VaultItemType, VaultTypePresentation> = {
  secret: { Icon: Vault, tone: 'neutral' },
  password: { Icon: LockKeyhole, tone: 'accent' },
  api_key: { Icon: KeyRound, tone: 'accent' },
  oauth: { Icon: ShieldCheck, tone: 'info' },
  login: { Icon: LogIn, tone: 'accent' },
  database: { Icon: Database, tone: 'info' },
  server: { Icon: ServerCog, tone: 'info' },
  ssh_key: { Icon: SquareTerminal, tone: 'warning' },
  certificate: { Icon: BadgeCheck, tone: 'warning' },
  totp: { Icon: TimerReset, tone: 'accent' },
  recovery_codes: { Icon: LifeBuoy, tone: 'warning' },
  crypto_wallet: { Icon: WalletCards, tone: 'warning' },
  bank_account: { Icon: Landmark, tone: 'info' },
  credit_card: { Icon: CreditCard, tone: 'info' },
  identity: { Icon: ContactRound, tone: 'neutral' },
  passport: { Icon: BookUser, tone: 'neutral' },
  driver_license: { Icon: IdCard, tone: 'neutral' },
  social_security_number: { Icon: Fingerprint, tone: 'warning' },
  email_account: { Icon: MailCheck, tone: 'accent' },
  document: { Icon: FileLock2, tone: 'neutral' },
  medical_record: { Icon: HeartPulse, tone: 'warning' },
  membership: { Icon: TicketCheck, tone: 'neutral' },
  outdoor_license: { Icon: TentTree, tone: 'neutral' },
  reward_program: { Icon: Gift, tone: 'neutral' },
  software_license: { Icon: PackageCheck, tone: 'accent' },
  wireless_router: { Icon: Wifi, tone: 'info' },
  secure_note: { Icon: NotebookPen, tone: 'neutral' },
}

export function vaultTypeIcon(type: VaultItemType): LucideIcon {
  return VAULT_TYPE_PRESENTATION[type].Icon
}
