import { expect, test } from 'bun:test'
import { transcriptPath } from '../../src/web/transcript/path.ts'

const SESSION = '8e38df20-0000-4000-8000-000000000001'

test("transcriptPath encodes /home/u/Sites/app as the spike's directory name", () => {
  expect(transcriptPath('/home/u', '/home/u/Sites/app', SESSION)).toBe(`/home/u/.claude/projects/-home-u-Sites-app/${SESSION}.jsonl`)
  expect(transcriptPath('/home/user', '/home/user/proj/app', SESSION)).toBe(`/home/user/.claude/projects/-home-user-proj-app/${SESSION}.jsonl`)
  expect(transcriptPath('/home/user', '/home/user/.config/tool', SESSION)).toBe(`/home/user/.claude/projects/-home-user--config-tool/${SESSION}.jsonl`)
  expect(transcriptPath('/home/user', '/home/user/my-app', SESSION)).toBe(`/home/user/.claude/projects/-home-user-my-app/${SESSION}.jsonl`)
})
