import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The host (src/) must not know an extension's implementation. It may load extensions through the one composition root,
 * and talk to them only through the extension SDK and the slot registries. Any other import from src/ into extensions/
 * fails this test.
 *
 * LEGACY lists files that still have such imports while they are being moved. Remove a file from it when its imports are gone;
 * the test fails if a listed file is already clean, so the list cannot go stale. Never add a file to it.
 */
const ROOT = join(import.meta.dir, '..', '..')
const SRC = join(ROOT, 'src')
const COMPOSITION_ROOT = new Set(['src/ui/extensions.ts'])
const LEGACY = new Set<string>()

// Matches a module specifier that reaches into extensions/ (static import, re-export, or dynamic import).
const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]*)['"]/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

function extensionImportsIn(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const hits: string[] = []
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? ''
    if (/(^|\/)extensions\//.test(specifier)) {
      hits.push(specifier)
    }
  }
  return hits
}

describe('host source does not import extension implementations', () => {
  it('no file outside the composition root and the legacy list reaches into extensions/', () => {
    const violations: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(ROOT, file)
      if (COMPOSITION_ROOT.has(rel) || LEGACY.has(rel)) {
        continue
      }
      for (const specifier of extensionImportsIn(file)) {
        violations.push(`${rel} imports ${specifier}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('every legacy file still has an import to remove, so the list stays honest', () => {
    const clean = [...LEGACY].filter(rel => extensionImportsIn(join(ROOT, rel)).length === 0)
    expect(clean).toEqual([])
  })
})
