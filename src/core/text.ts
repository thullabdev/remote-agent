export const REDACTED = '[REDACTED]'

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
]

const SECRET_NAME =
  '(?:[A-Za-z0-9_-]*(?:secret|token|password|passwd|api[-_]?key|private[-_]?key|access[-_]?key|authorization)[A-Za-z0-9_-]*|(?:[A-Za-z0-9]+[_-])*(?:pass|pwd|auth)\\b)'

// name, optional closing quote (JSON keys), separator, then a quoted value (may contain spaces) or a bare word.
const SECRET_ASSIGNMENT = new RegExp(`\\b(${SECRET_NAME})(["']?\\s*[=:]\\s*)("[^"]*"|'[^']*'|\\S+)`, 'gi')

const AUTH_SCHEME = /\b(Bearer|Basic) [A-Za-z0-9._~+/=-]{8,}/g

const URL_CREDENTIALS = /(:\/\/[^\s:/@]+:)[^\s@/]+@/g

function redactValue(value: string): string {
  const quote = value[0]
  if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
    return `${quote}${REDACTED}${quote}`
  }
  return REDACTED
}

export function redactSecrets(text: string): string {
  let out = text.replace(URL_CREDENTIALS, `$1${REDACTED}@`)
  out = out.replace(AUTH_SCHEME, `$1 ${REDACTED}`)
  out = out.replace(
    SECRET_ASSIGNMENT,
    (_match, name: string, separator: string, value: string) => `${name}${separator}${redactValue(value)}`,
  )
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  return out
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}… [+${text.length - max} chars]`
}

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
