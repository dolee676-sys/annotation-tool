import { contextBridge, ipcRenderer } from 'electron'

const EVENT_CHANNELS = [
  'panel:init',
  'panel:reset',
  'panel:context',
  'panel:delta',
  'panel:done',
  'panel:error'
] as const

type EventChannel = (typeof EVENT_CHANNELS)[number]

const api = {
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  panelReady: () => ipcRenderer.invoke('panel:ready'),
  panelClose: () => ipcRenderer.invoke('panel:close'),
  panelRegenerate: () => ipcRenderer.invoke('panel:regenerate'),
  panelAsk: (question: string) => ipcRenderer.invoke('panel:ask', question),
  panelSetPinned: (pinned: boolean) => ipcRenderer.invoke('panel:pin', pinned),
  panelSwitchModel: (payload: { providerId: string; model: string }) =>
    ipcRenderer.invoke('panel:switch-model', payload),
  on: (channel: EventChannel, callback: (payload: unknown) => void) => {
    if (!EVENT_CHANNELS.includes(channel)) return () => undefined
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('zhujie', api)
