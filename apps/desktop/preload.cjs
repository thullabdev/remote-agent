const { contextBridge, ipcRenderer } = require('electron')

const bridgeToken = ipcRenderer.sendSync('remote-agent:bridge-token')

contextBridge.exposeInMainWorld('remoteAgentDesktop', {
  bridgeToken,
})
