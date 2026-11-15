/** PTY bridge: runs under Node.js (node-pty needs native bindings Bun can't load).
 *
 * Reads JSON commands from stdin:
 *   { type: 'open', sid, cols, rows, cwd }
 *   { type: 'input', sid, data }
 *   { type: 'resize', sid, cols, rows }
 *   { type: 'close', sid }
 *
 * Writes JSON responses to stdout:
 *   { type: 'replay', sid, data }      (on open with existing sid, before live output)
 *   { type: 'output', sid, data }
 *   { type: 'exit', sid, code }
 *   { type: 'error', sid?, message }
 */

const pty = require('node-pty')
const readline = require('node:readline')

// Max buffered output per session (~5,000 lines / 1 MB, keep it simple: last 64 KB).
const MAX_BUFFER_BYTES = 64 * 1024

/** Sessions: sid -> { pty, buffer (array of strings), bufferBytes } */
const sessions = new Map()

function bufferAdd(sid, data) {
  const session = sessions.get(sid)
  if (!session) {
    return
  }
  session.buffer.push(data)
  session.bufferBytes += Buffer.byteLength(data, 'utf8')
  while (session.bufferBytes > MAX_BUFFER_BYTES && session.buffer.length > 0) {
    const removed = session.buffer.shift()
    if (removed !== undefined) {
      session.bufferBytes -= Buffer.byteLength(removed, 'utf8')
    }
  }
}

function replay(sid) {
  const session = sessions.get(sid)
  if (!session) {
    return ''
  }
  return session.buffer.join('')
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function spawnPty(sid, cols, rows, cwd) {
  const shell = process.env.SHELL || '/bin/sh'
  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || require('node:os').homedir(),
    env: {
      TERM: 'xterm-256color',
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      LOGNAME: process.env.LOGNAME,
    },
  })

  const session = {
    pty: term,
    buffer: [],
    bufferBytes: 0,
  }
  sessions.set(sid, session)

  term.onData(data => {
    bufferAdd(sid, data)
    send({ type: 'output', sid, data })
  })

  term.onExit(code => {
    send({ type: 'exit', sid, code })
    sessions.delete(sid)
  })

  return session
}

function closeSession(sid) {
  const session = sessions.get(sid)
  if (session) {
    try {
      session.pty.kill()
    } catch {
      // Already dead.
    }
    sessions.delete(sid)
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => {
  const trimmed = line.trim()
  if (trimmed === '') {
    return
  }
  let cmd
  try {
    cmd = JSON.parse(trimmed)
  } catch {
    send({ type: 'error', message: 'invalid json' })
    return
  }

  try {
    switch (cmd.type) {
      case 'open': {
        if (sessions.has(cmd.sid)) {
          // Reattach: send replay buffer, then live output continues.
          send({ type: 'replay', sid: cmd.sid, data: replay(cmd.sid) })
        } else {
          spawnPty(cmd.sid, cmd.cols, cmd.rows, cmd.cwd)
        }
        break
      }
      case 'input': {
        const session = sessions.get(cmd.sid)
        if (session) {
          session.pty.write(cmd.data)
        } else {
          send({ type: 'error', sid: cmd.sid, message: 'session not found' })
        }
        break
      }
      case 'resize': {
        const session = sessions.get(cmd.sid)
        if (session) {
          session.pty.resize(cmd.cols, cmd.rows)
        }
        break
      }
      case 'close': {
        closeSession(cmd.sid)
        break
      }
      default:
        send({ type: 'error', message: `unknown type: ${cmd.type}` })
    }
  } catch (error) {
    send({ type: 'error', sid: cmd.sid, message: error instanceof Error ? error.message : String(error) })
  }
})

process.stdin.on('end', () => {
  // Kill all PTYs on stdin close.
  for (const sid of sessions.keys()) {
    closeSession(sid)
  }
  process.exit(0)
})
