import { contextBridge, ipcRenderer } from 'electron'

const api = {
  chipClick: (action: 'annotate' | 'ask') => ipcRenderer.invoke('chip:click', action),
  getLocale: () => ipcRenderer.invoke('chip:locale'),
  onAppear: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('chip:appear', listener)
    return () => ipcRenderer.removeListener('chip:appear', listener)
  }
}

contextBridge.exposeInMainWorld('zhujie', api)
