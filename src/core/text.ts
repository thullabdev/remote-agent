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

const SECRET_ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:secret|token|password|passwd|api_key|apikey|private_key|access_key)[A-Za-z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"']+)\3/gi

export function redactSecrets(text: string): string {
  let out = text.replace(
    SECRET_ASSIGNMENT,
    (_match, name: string, separator: string, quote: string) => `${name}${separator}${quote}${REDACTED}${quote}`,
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
