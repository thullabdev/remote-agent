function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]))
  }
  return value
}

/** JSON with object keys sorted at every depth, so equal values compare equal as strings. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'undefined'
}
