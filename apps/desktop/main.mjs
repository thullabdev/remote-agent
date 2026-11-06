import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { readBridgeConfig } from './bridge-config.mjs'

app.setName('Remote Agent')

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const staticDir = join(projectRoot, 'dist', 'web-channel')
const bridgeDataDir = join(app.getPath('userData'), 'bridge-data')
const socketPath = join(bridgeDataDir, `bridge-${process.pid}.sock`)
const desktopLogin = 'desktop@localhost'
let bridge = null
let bridgeOrigin = null
let bridgeToken = null
let quitting = false
let cleanupStarted = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window !== undefined) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      const config = readBridgeConfig(process.env)
      if (config.mode === 'managed') {
        if (!existsSync(join(staticDir, 'index.html'))) {
          throw new Error('The desktop UI build is missing. Run `bun run desktop:dev` from the repository root.')
        }
        const managed = await startBridge()
        bridge = managed.child
        bridgeOrigin = managed.origin
        bridgeToken = managed.token
      } else {
        bridgeOrigin = config.origin
        bridgeToken = config.token
        await waitForBridge(bridgeOrigin, bridgeToken, null, () => '', config.token === null)
      }
      ipcMain.on('remote-agent:bridge-token', event => {
        try {
          event.returnValue = new URL(event.senderFrame.url).origin === bridgeOrigin ? bridgeToken : null
        } catch {
          event.returnValue = null
        }
      })
      installLocalAuthentication(bridgeOrigin, bridgeToken, config.mode === 'managed')
      await openWindow()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          void openWindow()
        }
      })
    } catch (error) {
      await stopBridge()
      if (quitting) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Could not start the Remote Agent desktop app: ${message}`)
      dialog.showErrorBox('Remote Agent could not start', message)
      app.quit()
    }
  })

  app.on('before-quit', event => {
    if (cleanupStarted) {
      return
    }
    event.preventDefault()
    quitting = true
    cleanupStarted = true
    void stopBridge().finally(() => {
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  process.on('SIGINT', () => app.quit())
  process.on('SIGTERM', () => app.quit())
}

async function openWindow() {
  if (quitting || bridgeOrigin === null) {
    return
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 720,
    minHeight: 560,
    title: 'Remote Agent',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(projectRoot, 'apps', 'desktop', 'preload.cjs'),
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== bridgeOrigin && !url.startsWith(`${bridgeOrigin}/`)) {
      event.preventDefault()
    }
  })
  await window.loadURL(bridgeOrigin)
}

function installLocalAuthentication(origin, token, useDesktopLogin) {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${origin}/*`] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders }
      if (token !== null) {
        requestHeaders.Authorization = `Bearer ${token}`
      }
      if (useDesktopLogin) {
        requestHeaders['Tailscale-User-Login'] = desktopLogin
      }
      callback({
        requestHeaders,
      })
    },
  )
}

async function startBridge() {
  const bun = process.env.BUN_EXECUTABLE || 'bun'
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const port = await availablePort()
    const origin = `http://127.0.0.1:${port}`
    const token = randomBytes(32).toString('base64url')
    const child = spawn(bun, ['run', 'src/bridge/main.ts'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        REMOTE_AGENT_CHANNELS: 'web',
        REMOTE_AGENT_DB: join(bridgeDataDir, 'bridge.db'),
        REMOTE_AGENT_SOCKET: socketPath,
        REMOTE_AGENT_WEB_PORT: String(port),
        REMOTE_AGENT_WEB_ALLOWED_LOGIN: desktopLogin,
        REMOTE_AGENT_WEB_ORIGINS: origin,
        REMOTE_AGENT_WEB_TOKEN: token,
        REMOTE_AGENT_WEB_STATIC: staticDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    bridge = child
    let output = ''
    child.stdout.on('data', chunk => {
      output = appendOutput(output, chunk)
      process.stdout.write(chunk)
    })
    child.stderr.on('data', chunk => {
      output = appendOutput(output, chunk)
      process.stderr.write(chunk)
    })
    try {
      await waitForBridge(origin, token, child, () => output)
      return { child, origin, token }
    } catch (error) {
      lastError = error
      if (bridge === child) {
        bridge = null
      }
      await stopChild(child)
      if (quitting) {
        throw error
      }
      if (!/EADDRINUSE|address already in use/i.test(errorText(error))) {
        throw error
      }
    }
  }
  throw new Error(`Could not find a free loopback port for the Bridge after five attempts: ${errorText(lastError)}`)
}

function appendOutput(current, chunk) {
  return `${current}${chunk.toString()}`.slice(-16_000)
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Could not determine an available local port.'))
        return
      }
      server.close(error => {
        if (error !== undefined) {
          reject(error)
        } else {
          resolvePort(address.port)
        }
      })
    })
  })
}

async function waitForBridge(origin, token, child = null, getOutput = () => '', allowUnauthenticated = false) {
  let childError = null
  child?.once('error', error => {
    childError = error
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (childError !== null) {
      throw new Error(`Could not launch Bun (${childError.message}). Install Bun or set BUN_EXECUTABLE.`)
    }
    if (child !== null && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`The Bridge exited before it became ready (${child.exitCode ?? child.signalCode}).\n${getOutput()}`)
    }
    try {
      const headers = {
        Origin: origin,
      }
      if (token !== null) {
        headers.Authorization = `Bearer ${token}`
        headers['Tailscale-User-Login'] = desktopLogin
      }
      const response = await fetch(`${origin}/api/state`, {
        headers: {
          ...headers,
        },
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok || allowUnauthenticated) {
        return
      }
      if (!allowUnauthenticated && (response.status === 401 || response.status === 403)) {
        throw new Error(`The Bridge rejected desktop authentication (${response.status}). Check the URL origin and bearer token.`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('rejected desktop authentication')) {
        throw error
      }
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
  }
  throw new Error(`Timed out waiting for the local Bridge to start.\n${getOutput()}`)
}

async function stopBridge() {
  if (bridge !== null) {
    const child = bridge
    bridge = null
    await stopChild(child)
  }
}

async function stopChild(child) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return
  }
  await new Promise(resolveStop => {
    let stopped = false
    const finish = () => {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      resolveStop()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish()
    }, 5_000)
    child.once('exit', finish)
    child.kill('SIGTERM')
  })
}
