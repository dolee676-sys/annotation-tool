import { contextBridge, ipcRenderer } from 'electron'

const api = {
  chipClick: (action: 'annotate' | 'ask') => ipcRenderer.invoke('chip:click', action)
}

contextBridge.exposeInMainWorld('zhujie', api)
