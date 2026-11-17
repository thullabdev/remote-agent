import { describe, expect, test } from 'bun:test'
import { iconKeyFor } from './file-icon.ts'

describe('iconKeyFor', () => {
  test('code files get the code icon', () => {
    for (const path of ['src/a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'style.css', 'index.html', 'main.py', 'main.go', 'lib.rs', 'App.java', 'run.sh']) {
      expect(iconKeyFor(path)).toBe('code')
    }
  })

  test('json, text, image and config files each have their own key', () => {
    expect(iconKeyFor('package.json')).toBe('json')
    expect(iconKeyFor('README.md')).toBe('text')
    expect(iconKeyFor('notes.txt')).toBe('text')
    expect(iconKeyFor('guide.rst')).toBe('text')
    expect(iconKeyFor('logo.png')).toBe('image')
    expect(iconKeyFor('photo.JPG')).toBe('image')
    expect(iconKeyFor('icon.svg')).toBe('image')
    expect(iconKeyFor('ci.yml')).toBe('config')
    expect(iconKeyFor('config.yaml')).toBe('config')
    expect(iconKeyFor('Cargo.toml')).toBe('config')
    expect(iconKeyFor('setup.ini')).toBe('config')
    expect(iconKeyFor('app/.env')).toBe('config')
    expect(iconKeyFor('bun.lock')).toBe('config')
  })

  test('anything else, and a name with no extension, is a plain file', () => {
    expect(iconKeyFor('archive.tar.gz')).toBe('file')
    expect(iconKeyFor('Dockerfile')).toBe('file')
    expect(iconKeyFor('dir.v2/Makefile')).toBe('file')
    expect(iconKeyFor('a.constructor')).toBe('file')
  })

  test('only the file name decides, not the folders', () => {
    expect(iconKeyFor('docs.d/readme')).toBe('file')
    expect(iconKeyFor('src.ts/notes')).toBe('file')
  })
})
