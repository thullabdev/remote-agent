import { describe, expect, test } from 'bun:test'
import { parseLog, parseNumstat, parseStatusV2, parseUnifiedDiff } from './parse.ts'

describe('parseStatusV2', () => {
  test('paths with spaces and unicode survive -z parsing', () => {
    const out = '1 .M N... 100644 100644 100644 abc abc docs/My Notes ü.md\0'
    expect(parseStatusV2(out).unstaged.map(f => f.path)).toEqual(['docs/My Notes ü.md'])
  })

  test('rename entries carry the new path and the old one', () => {
    const out = '2 R. N... 100644 100644 100644 a b R100 new name.ts\0old name.ts\0'
    const [change] = parseStatusV2(out).staged
    expect([change?.path, change?.oldPath, change?.status]).toEqual(['new name.ts', 'old name.ts', 'renamed'])
  })

  test('a file staged and modified again appears in both lists', () => {
    const out = '1 MM N... 100644 100644 100644 a a x.ts\0'
    const result = parseStatusV2(out)
    expect(result.staged.map(f => f.path)).toEqual(['x.ts'])
    expect(result.unstaged.map(f => f.path)).toEqual(['x.ts'])
  })

  test('untracked files are unstaged with status untracked', () => {
    expect(parseStatusV2('? new.ts\0').unstaged[0]).toMatchObject({ path: 'new.ts', status: 'untracked' })
  })
})

describe('parseNumstat', () => {
  test('numstat counts lines and reports binary files as binary', () => {
    const map = parseNumstat('3\t1\tsrc/a.ts\0-\t-\timage.png\0')
    expect(map.get('src/a.ts')).toEqual({ added: 3, removed: 1, binary: false })
    expect(map.get('image.png')).toEqual({ added: null, removed: null, binary: true })
  })
})

describe('parseLog', () => {
  test('log marks commits reachable from upstream as pushed', () => {
    const rec = (sha: string, subject: string) => `${sha}\x1f${sha.slice(0, 7)}\x1fAna\x1f1700000000\x1f${subject}\x1e`
    const commits = parseLog(rec('aaaa111aaaa', 'one') + rec('bbbb222bbbb', 'two'), new Set(['aaaa111aaaa']))
    expect(commits.map(c => [c.subject, c.pushed])).toEqual([['one', true], ['two', false]])
  })

  test('an empty log (unborn branch) yields no commits', () => {
    expect(parseLog('', new Set())).toEqual([])
  })
})

describe('parseUnifiedDiff', () => {
  test('diff hunks number lines from the @@ header', () => {
    const diff = '@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n'
    const { hunks, binary } = parseUnifiedDiff(diff)
    expect(binary).toBe(false)
    expect(hunks[0]?.lines.map(l => [l.kind, l.oldLine, l.newLine])).toEqual([['context', 1, 1], ['removed', 2, null], ['added', null, 2], ['added', null, 3]])
  })

  test('a binary diff has no hunks', () => {
    expect(parseUnifiedDiff('Binary files a/x.png and b/x.png differ\n')).toEqual({ binary: true, hunks: [] })
  })
})
