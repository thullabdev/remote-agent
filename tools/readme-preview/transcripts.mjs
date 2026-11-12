// Writes demo Claude Code transcripts into the throwaway Bridge's HOME, so the demo Sessions show agent activity:
// agent text, tool runs and an Edit diff. The Bridge reads them like real transcripts.
// Usage: bun transcripts.mjs <home folder>
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const home = process.argv[2]
if (!home) {
  throw new Error('Usage: bun transcripts.mjs <home folder>')
}

const START = Date.now() - 7 * 60_000

function transcriptFile(cwd, sessionId) {
  // The same encoding as src/channel/web/transcript/path.ts.
  const directory = join(home, '.claude', 'projects', cwd.replace(/[/.]/g, '-'))
  mkdirSync(directory, { recursive: true })
  return join(directory, `${sessionId}.jsonl`)
}

/** Builds a transcript from steps; every step is a few seconds after the last. */
function build(sessionId, steps) {
  let at = START
  const lines = []
  for (const step of steps) {
    at += step.after ?? 25_000
    const base = { uuid: randomUUID(), sessionId, timestamp: new Date(at).toISOString() }
    if (step.user) {
      lines.push({ type: 'user', ...base, message: { role: 'user', content: step.user } })
    } else if (step.say) {
      lines.push({ type: 'assistant', ...base, message: { id: `msg_${randomUUID()}`, role: 'assistant', content: [{ type: 'text', text: step.say }] } })
    } else if (step.tool) {
      const id = `toolu_${randomUUID().replaceAll('-', '').slice(0, 20)}`
      lines.push({
        type: 'assistant',
        ...base,
        message: { id: `msg_${randomUUID()}`, role: 'assistant', content: [{ type: 'tool_use', id, name: step.tool, input: step.input }] },
      })
      if (step.result !== undefined) {
        lines.push({
          type: 'user',
          uuid: randomUUID(),
          sessionId,
          timestamp: new Date(at + 2_000).toISOString(),
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: step.result }] },
        })
      }
    } else if (step.turnEnd) {
      lines.push({ type: 'system', subtype: 'turn_duration', ...base })
    }
  }
  return `${lines.map(line => JSON.stringify(line)).join('\n')}\n`
}

const sessions = [
  {
    id: 'demo-web',
    cwd: '/home/demo/web-app',
    steps: [
      { user: 'Signed-in users keep getting sent back to /login after a refresh. Can you fix the redirect?' },
      { say: "I'll start by finding where the redirect decides whether you are signed in." },
      {
        tool: 'Grep',
        input: { pattern: 'loginRedirect', path: 'src' },
        result: 'src/auth/redirect.ts:12:export async function loginRedirect(request: Request) {\nsrc/routes/app.tsx:22:  const redirect = await loginRedirect(request)',
      },
      { say: '`loginRedirect` checks for a cookie before the session has loaded, so a refresh always looks signed out.' },
      {
        tool: 'Read',
        input: { file_path: 'src/auth/redirect.ts' },
        result: "12\texport async function loginRedirect(request: Request) {\n13\t  if (!request.cookies.has('sid')) {\n14\t    return redirect('/login')\n15\t  }\n16\t  return null\n17\t}",
      },
      { say: "I'll load the session first and only redirect when there really is none." },
      {
        tool: 'Edit',
        input: {
          file_path: 'src/auth/redirect.ts',
          old_string: "  if (!request.cookies.has('sid')) {\n    return redirect('/login')\n  }",
          new_string: '  const session = await getSession(request)\n  if (session === null) {\n    return redirect(\'/login\')\n  }',
        },
        result: 'The file src/auth/redirect.ts has been updated.',
      },
      { say: "That fixes the check. I'll run the tests to confirm it." },
    ],
  },
  {
    id: 'demo-api',
    cwd: '/home/demo/api-service',
    steps: [
      { user: 'Reads dominate the load on the product endpoints. Add caching, whatever fits best.' },
      { say: "Let me look at how products are read today." },
      {
        tool: 'Read',
        input: { file_path: 'src/products/repository.ts' },
        result: "8\texport async function getProduct(id: string) {\n9\t  return db.query('select * from products where id = $1', [id])\n10\t}",
      },
      { say: "There are three reasonable options and they trade simplicity against sharing across instances, so I'd like your call before I build anything." },
    ],
  },
  {
    id: 'demo-docs',
    cwd: '/home/demo/docs-site',
    steps: [
      { user: 'The install guide still mentions the old CLI. Please refresh it.' },
      { say: "I'll update the commands and check the links." },
      {
        tool: 'Edit',
        input: {
          file_path: 'docs/install.md',
          old_string: 'Run `docs-cli init` to create a project.',
          new_string: 'Run `npm create docs@latest` to create a project.',
        },
        result: 'The file docs/install.md has been updated.',
      },
      { turnEnd: true },
    ],
  },
  {
    id: 'demo-mobile',
    cwd: '/home/demo/mobile-app',
    steps: [
      { user: 'Add the three onboarding screens and wire up the skip button.' },
      { say: 'The screens are in place and the skip action is wired up. I am running the linter now.' },
      // No result and no turn end: the Session is working, with this tool running.
      { tool: 'Bash', input: { command: 'bun run lint' } },
    ],
  },
]

for (const session of sessions) {
  writeFileSync(transcriptFile(session.cwd, session.id), build(session.id, session.steps))
}
console.log(`transcripts: wrote ${sessions.length} files under ${home}/.claude/projects`)
