import { describe, expect, test } from 'bun:test'
import { escapeHtml, REDACTED, redactSecrets, truncate } from '../../src/core/text.ts'

describe('truncate', () => {
  test('returns short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })
  test('cuts long text and says how much was dropped', () => {
    expect(truncate('abcdefghij', 4)).toBe('abcd… [+6 chars]')
  })
})

describe('redactSecrets', () => {
  test('redacts KEY=value assignments with secret-looking names', () => {
    expect(redactSecrets('API_KEY=abc123 other=fine')).toBe(`API_KEY=${REDACTED} other=fine`)
    expect(redactSecrets('export GITHUB_TOKEN="ghp_abc"')).toBe(`export GITHUB_TOKEN="${REDACTED}"`)
    expect(redactSecrets('password: hunter2')).toBe(`password: ${REDACTED}`)
  })
  test('redacts well-known token formats anywhere', () => {
    const anthropic = 'sk-ant-api03-' + 'a'.repeat(40)
    const aws = 'AKIA' + 'B'.repeat(16)
    const telegram = '123456789:' + 'C'.repeat(35)
    const out = redactSecrets(`curl -H "x-api-key: ${anthropic}" ${aws} ${telegram}`)
    expect(out).not.toContain(anthropic)
    expect(out).not.toContain(aws)
    expect(out).not.toContain(telegram)
  })
  test('redacts PEM private keys', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----'
    expect(redactSecrets(`key:\n${pem}\nend`)).toBe(`key:\n${REDACTED}\nend`)
  })
  test('leaves ordinary code alone', () => {
    expect(redactSecrets('const total = items.length')).toBe('const total = items.length')
  })
})

describe('escapeHtml', () => {
  test('escapes the three characters Telegram HTML requires', () => {
    expect(escapeHtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d')
  })
})
