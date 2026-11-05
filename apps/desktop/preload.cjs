const { contextBridge, ipcRenderer } = require('electron')

const bridgeToken = ipcRenderer.sendSync('remote-agent:bridge-token')
if (typeof bridgeToken !== 'string' || bridgeToken === '') {
  throw new Error('The desktop Bridge token was not provided to the renderer.')
}

contextBridge.exposeInMainWorld('remoteAgentDesktop', {
  bridgeToken,
})
