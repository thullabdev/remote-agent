import { expect, test } from 'bun:test'
import { transcriptPath } from '../../../src/channel/web/transcript/path.ts'

const SESSION = '8e38df20-0000-4000-8000-000000000001'

test("transcriptPath encodes /home/u/Sites/app as the spike's directory name", () => {
  expect(transcriptPath('/home/u', '/home/u/Sites/app', SESSION)).toBe(`/home/u/.claude/projects/-home-u-Sites-app/${SESSION}.jsonl`)
  expect(transcriptPath('/home/user', '/home/user/proj/app', SESSION)).toBe(`/home/user/.claude/projects/-home-user-proj-app/${SESSION}.jsonl`)
  expect(transcriptPath('/home/user', '/home/user/.config/tool', SESSION)).toBe(`/home/user/.claude/projects/-home-user--config-tool/${SESSION}.jsonl`)
  expect(transcriptPath('/home/user', '/home/user/my-app', SESSION)).toBe(`/home/user/.claude/projects/-home-user-my-app/${SESSION}.jsonl`)
})

test('transcriptPath refuses a session id that is not a plain id, so it cannot escape the projects folder', () => {
  expect(() => transcriptPath('/home/u', '/home/u/app', '../../etc/passwd')).toThrow()
  expect(() => transcriptPath('/home/u', '/home/u/app', '-rf')).toThrow()
  expect(() => transcriptPath('/home/u', '/home/u/app', 'a/b')).toThrow()
  expect(() => transcriptPath('/home/u', '/home/u/app', '')).toThrow()
})

