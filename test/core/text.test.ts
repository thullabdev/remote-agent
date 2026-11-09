import { describe, expect, test } from 'bun:test'
import { clipChars, escapeHtml, REDACTED, redactSecrets, stripMarkdown, truncate } from '../../src/core/text.ts'

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
  test('redacts JSON-quoted keys', () => {
    expect(redactSecrets('{"password": "hunter2"}')).toBe(`{"password": "${REDACTED}"}`)
    expect(redactSecrets('{"token":"abc"}')).toBe(`{"token":"${REDACTED}"}`)
  })
  test('redacts quoted values containing spaces', () => {
    expect(redactSecrets('password="my pass phrase" next')).toBe(`password="${REDACTED}" next`)
    expect(redactSecrets("secret='a b c'")).toBe(`secret='${REDACTED}'`)
  })
  test('redacts Authorization Bearer and Basic credentials', () => {
    expect(redactSecrets('Authorization: Bearer abcdefgh12345')).not.toContain('abcdefgh12345')
    expect(redactSecrets('curl -H "Authorization: Basic dXNlcjpwYXNz"')).not.toContain('dXNlcjpwYXNz')
    expect(redactSecrets('got Bearer abcdefgh12345 here')).toBe(`got Bearer ${REDACTED} here`)
  })
  test('redacts hyphenated header and key names', () => {
    expect(redactSecrets('X-Api-Key: v123')).toBe(`X-Api-Key: ${REDACTED}`)
    expect(redactSecrets('api-key=v123')).toBe(`api-key=${REDACTED}`)
    expect(redactSecrets('auth_token=v123')).toBe(`auth_token=${REDACTED}`)
  })
  test('redacts URL credentials but keeps scheme, user and host', () => {
    expect(redactSecrets('postgres://u:pw@host/db')).toBe(`postgres://u:${REDACTED}@host/db`)
    expect(redactSecrets('git clone https://u:pw@github.com/a/b')).toBe(`git clone https://u:${REDACTED}@github.com/a/b`)
  })
  test('redacts short password names', () => {
    expect(redactSecrets('DB_PASS=x')).toBe(`DB_PASS=${REDACTED}`)
    expect(redactSecrets('pass=x')).toBe(`pass=${REDACTED}`)
    expect(redactSecrets('pwd=x')).toBe(`pwd=${REDACTED}`)
    expect(redactSecrets('passwd: x')).toBe(`passwd: ${REDACTED}`)
  })
  test('does not redact words that merely contain pass or auth', () => {
    expect(redactSecrets('passed = true')).toBe('passed = true')
    expect(redactSecrets('author: bob')).toBe('author: bob')
    expect(redactSecrets('compass=north')).toBe('compass=north')
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

test('stripMarkdown leaves the words a reader would see', () => {
  expect(stripMarkdown('The fix is committed as `7ade68a`, merged into `main`')).toBe('The fix is committed as 7ade68a, merged into main')
  expect(stripMarkdown('## Lino\'s "under 10 a day" can only be partly checked')).toBe('Lino\'s "under 10 a day" can only be partly checked')
  expect(stripMarkdown('**Done** and *tested*, see [the PR](https://x.test/1)')).toBe('Done and tested, see the PR')
  expect(stripMarkdown('- one\n- [x] two\n1. three')).toBe('one two three')
  expect(stripMarkdown('> quoted\n\n```ts\nconst a = 1\n```')).toBe('quoted const a = 1')
})

test('stripMarkdown keeps snake_case, multiplication and plain text intact', () => {
  expect(stripMarkdown('set my_var_name to 2 * 3 * 4')).toBe('set my_var_name to 2 * 3 * 4')
  expect(stripMarkdown('')).toBe('')
})

test('stripMarkdown drops table scaffolding and HTML tags but keeps comparisons', () => {
  expect(stripMarkdown('| name | size |\n|------|------|\n| a.ts | 3 |')).toBe('name size a.ts 3')
  expect(stripMarkdown('line one<br>line two <b>bold</b>')).toBe('line one line two bold')
  expect(stripMarkdown('if a < b and c > d')).toBe('if a < b and c > d')
})

test('clipChars cuts by character, never inside a surrogate pair', () => {
  expect(clipChars('abcdef', 3)).toBe('abc')
  expect(clipChars('ab😀cd', 3)).toBe('ab😀')
  expect(clipChars('short', 10)).toBe('short')
})
