/**
 * Stable Localix item kinds. This is intentionally a string vocabulary rather than
 * a database enum: external backends (1Password, Infisical, OS keychains) can map
 * their richer categories onto it without a storage migration for every new kind.
 */
export const VAULT_ITEM_TYPES = [
  'secret',
  'password',
  'api_key',
  'oauth',
  'login',
  'database',
  'server',
  'ssh_key',
  'certificate',
  'totp',
  'recovery_codes',
  'crypto_wallet',
  'bank_account',
  'credit_card',
  'identity',
  'passport',
  'driver_license',
  'social_security_number',
  'email_account',
  'document',
  'medical_record',
  'membership',
  'outdoor_license',
  'reward_program',
  'software_license',
  'wireless_router',
  'secure_note',
] as const

export type VaultItemType = (typeof VAULT_ITEM_TYPES)[number]

export type VaultItemGroup = 'developer' | 'access' | 'finance' | 'identity' | 'personal'

export interface VaultItemTypeDefinition {
  label: string
  group: VaultItemGroup
  valueLabel: string
  valuePlaceholder: string
  highImpact?: boolean
}

/**
 * One canonical category registry shared by HTTP contracts, agent tools and the UI.
 * Categories follow 1Password's durable item vocabulary where it fits Localix, with
 * developer-specific credentials kept first-class. The encrypted payload is already
 * a field map, so richer per-category fields can be added without changing item identity.
 */
export const VAULT_ITEM_TYPE_DEFINITIONS: Record<VaultItemType, VaultItemTypeDefinition> = {
  secret: {
    label: 'Generic secret',
    group: 'developer',
    valueLabel: 'Secret value',
    valuePlaceholder: 'Paste secret value',
  },
  password: {
    label: 'Password',
    group: 'access',
    valueLabel: 'Password',
    valuePlaceholder: 'Enter password',
  },
  api_key: {
    label: 'API credential',
    group: 'developer',
    valueLabel: 'API key or token',
    valuePlaceholder: 'Paste API credential',
  },
  oauth: {
    label: 'OAuth credential',
    group: 'developer',
    valueLabel: 'Token payload',
    valuePlaceholder: 'Paste token or encrypted token bundle',
  },
  login: {
    label: 'Login',
    group: 'access',
    valueLabel: 'Password',
    valuePlaceholder: 'Enter account password',
  },
  database: {
    label: 'Database credential',
    group: 'developer',
    valueLabel: 'Password or connection secret',
    valuePlaceholder: 'Paste database credential',
  },
  server: {
    label: 'Server',
    group: 'developer',
    valueLabel: 'Server credential',
    valuePlaceholder: 'Paste server credential',
  },
  ssh_key: {
    label: 'SSH key',
    group: 'developer',
    valueLabel: 'Private key',
    valuePlaceholder: 'Paste private key',
    highImpact: true,
  },
  certificate: {
    label: 'Certificate',
    group: 'developer',
    valueLabel: 'Private key or certificate bundle',
    valuePlaceholder: 'Paste PEM or certificate bundle',
    highImpact: true,
  },
  totp: {
    label: 'One-time password',
    group: 'access',
    valueLabel: 'TOTP secret or URI',
    valuePlaceholder: 'Paste otpauth:// URI or seed',
  },
  recovery_codes: {
    label: 'Recovery codes',
    group: 'access',
    valueLabel: 'Recovery codes',
    valuePlaceholder: 'Paste recovery codes',
    highImpact: true,
  },
  crypto_wallet: {
    label: 'Crypto wallet',
    group: 'finance',
    valueLabel: 'Seed phrase or private key',
    valuePlaceholder: 'Enter seed phrase or private key',
    highImpact: true,
  },
  bank_account: {
    label: 'Bank account',
    group: 'finance',
    valueLabel: 'Sensitive account details',
    valuePlaceholder: 'Enter account details',
  },
  credit_card: {
    label: 'Credit card',
    group: 'finance',
    valueLabel: 'Card details',
    valuePlaceholder: 'Enter card details',
  },
  identity: {
    label: 'Identity',
    group: 'identity',
    valueLabel: 'Identity details',
    valuePlaceholder: 'Enter sensitive identity details',
  },
  passport: {
    label: 'Passport',
    group: 'identity',
    valueLabel: 'Passport details',
    valuePlaceholder: 'Enter passport details',
    highImpact: true,
  },
  driver_license: {
    label: 'Driver license',
    group: 'identity',
    valueLabel: 'License details',
    valuePlaceholder: 'Enter driver license details',
  },
  social_security_number: {
    label: 'Social security number',
    group: 'identity',
    valueLabel: 'Identifier',
    valuePlaceholder: 'Enter sensitive identifier',
    highImpact: true,
  },
  email_account: {
    label: 'Email account',
    group: 'access',
    valueLabel: 'Email password',
    valuePlaceholder: 'Enter email credential',
  },
  document: {
    label: 'Document',
    group: 'personal',
    valueLabel: 'Protected document data',
    valuePlaceholder: 'Paste protected document data',
  },
  medical_record: {
    label: 'Medical record',
    group: 'personal',
    valueLabel: 'Medical record',
    valuePlaceholder: 'Enter private medical information',
    highImpact: true,
  },
  membership: {
    label: 'Membership',
    group: 'personal',
    valueLabel: 'Membership details',
    valuePlaceholder: 'Enter membership details',
  },
  outdoor_license: {
    label: 'Outdoor license',
    group: 'personal',
    valueLabel: 'License details',
    valuePlaceholder: 'Enter license details',
  },
  reward_program: {
    label: 'Reward program',
    group: 'personal',
    valueLabel: 'Program details',
    valuePlaceholder: 'Enter reward program details',
  },
  software_license: {
    label: 'Software license',
    group: 'personal',
    valueLabel: 'License key',
    valuePlaceholder: 'Enter software license key',
  },
  wireless_router: {
    label: 'Wireless router',
    group: 'access',
    valueLabel: 'Wi-Fi password',
    valuePlaceholder: 'Enter Wi-Fi password',
  },
  secure_note: {
    label: 'Secure note',
    group: 'personal',
    valueLabel: 'Private note',
    valuePlaceholder: 'Write encrypted note',
  },
}
