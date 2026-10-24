/**
 * Built-in domain lists - the baseline that moderators adjust through
 * url_domains (see domain_registry.ts). Entries are host suffixes: an entry
 * matches the host itself and every subdomain of it, and the most specific
 * entry wins ("drive.google.com" can be user content while "google.com" is
 * on no list).
 *
 * - allow: legitimate manufacturing/3D-printing resources and carrier
 *   tracking. Lifts the "unknown link" hold only - never an exemption from
 *   the contact or advertising rules (a vendor's own Printables profile is
 *   still a way to take a customer off-platform).
 * - user_content: file sharing and hosting. Customers legitimately send "my
 *   CAD is on Drive", but it's also the top phishing carrier and the domain
 *   says nothing about the file, so every such URL gets its own reputation
 *   check and is never auto-allowed.
 */
export type DomainListStatus = 'allow' | 'block' | 'user_content' | 'none'

export const BUILTIN_DOMAIN_LISTS: ReadonlyMap<string, DomainListStatus> = new Map([
  // MakeXYZ itself
  ['makexyz.com', 'allow'],
  // Model repositories and CAD
  ['thingiverse.com', 'allow'],
  ['printables.com', 'allow'],
  ['myminifactory.com', 'allow'],
  ['cults3d.com', 'allow'],
  ['grabcad.com', 'allow'],
  ['onshape.com', 'allow'],
  ['autodesk.com', 'allow'],
  // Parts, printers and materials
  ['mcmaster.com', 'allow'],
  ['prusa3d.com', 'allow'],
  ['bambulab.com', 'allow'],
  ['formlabs.com', 'allow'],
  ['ultimaker.com', 'allow'],
  // Carrier tracking
  ['ups.com', 'allow'],
  ['usps.com', 'allow'],
  ['fedex.com', 'allow'],
  ['dhl.com', 'allow'],
  // File sharing and hosting
  ['drive.google.com', 'user_content'],
  ['docs.google.com', 'user_content'],
  ['dropbox.com', 'user_content'],
  ['dropboxusercontent.com', 'user_content'],
  ['onedrive.live.com', 'user_content'],
  ['sharepoint.com', 'user_content'],
  ['wetransfer.com', 'user_content'],
  ['box.com', 'user_content'],
  ['github.com', 'user_content'],
  ['githubusercontent.com', 'user_content'],
  ['gitlab.com', 'user_content'],
  ['mega.nz', 'user_content'],
  ['mediafire.com', 'user_content'],
])

/**
 * Link shorteners - the destination is hidden, so the redirect is always
 * followed before the link is judged (by where it ends up).
 */
export const SHORTENERS: ReadonlySet<string> = new Set([
  'bit.ly',
  'bitly.com',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'goo.su',
  'ow.ly',
  'is.gd',
  'v.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'shorturl.at',
  'rb.gy',
  't.ly',
  'tiny.cc',
  'bl.ink',
  's.id',
  'lnkd.in',
  '1drv.ms',
  'we.tl',
  'aka.ms',
])

/**
 * TLDs with a high share of abuse registrations. Only adds risk-score weight -
 * plenty of legitimate businesses use them.
 */
export const HIGH_ABUSE_TLDS: ReadonlySet<string> = new Set([
  'top',
  'xyz',
  'click',
  'link',
  'work',
  'gq',
  'ml',
  'cf',
  'tk',
  'ga',
  'buzz',
  'rest',
  'fit',
  'cyou',
  'icu',
  'sbs',
  'lol',
  'mom',
  'beauty',
  'hair',
  'quest',
  'bond',
  'cfd',
  'monster',
  'zip',
  'mov',
])

/**
 * Names phishers imitate. A domain whose name *looks like* one of these
 * (paypa1, rnakexyz, Cyrillic look-alikes) without being it is blocked. An
 * exact name on another TLD (dhl.de, amazon.co.uk) is a country site, not a
 * look-alike, and isn't flagged.
 */
export const IMPERSONATED_BRANDS: readonly string[] = [
  'makexyz',
  'paypal',
  'stripe',
  'venmo',
  'zelle',
  'google',
  'gmail',
  'apple',
  'icloud',
  'microsoft',
  'outlook',
  'office',
  'onedrive',
  'sharepoint',
  'amazon',
  'ups',
  'usps',
  'fedex',
  'dhl',
  'dropbox',
  'docusign',
  'wetransfer',
  'github',
  'thingiverse',
  'printables',
  'autodesk',
  'mcmaster',
  'bambulab',
  'prusa3d',
  'formlabs',
  'chase',
  'wellsfargo',
  'bankofamerica',
  'coinbase',
  'binance',
  'facebook',
  'instagram',
  'whatsapp',
  'linkedin',
  'adobe',
]

/** Path extensions that mean "download and run this". */
export const DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe',
  'scr',
  'msi',
  'msix',
  'appx',
  'apk',
  'dmg',
  'pkg',
  'js',
  'vbs',
  'bat',
  'cmd',
  'ps1',
  'jar',
  'iso',
  'lnk',
  'hta',
])

/** Archives - blocked from domains not on the allow list (they hide what's inside). */
export const ARCHIVE_EXTENSIONS: ReadonlySet<string> = new Set(['zip', 'rar', '7z'])
