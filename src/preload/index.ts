import { contextBridge, ipcRenderer } from 'electron'

const EVENT_CHANNELS = [
  'state:changed',
  'usage:changed',
  'panel:init',
  'panel:reset',
  'panel:delta',
  'panel:done',
  'panel:error',
  'history:changed'
] as const

type EventChannel = (typeof EVENT_CHANNELS)[number]

const api = {
  getState: () => ipcRenderer.invoke('state:get'),
  listApps: (force?: boolean) => ipcRenderer.invoke('apps:list', force),
  updateSettings: (patch: unknown) => ipcRenderer.invoke('settings:update', patch),
  saveProvider: (patch: unknown) => ipcRenderer.invoke('provider:save', patch),
  removeProvider: (id: string) => ipcRenderer.invoke('provider:remove', id),
  testProvider: (id: string) => ipcRenderer.invoke('provider:test', id),
  getUsage: () => ipcRenderer.invoke('usage:get'),
  clearUsage: () => ipcRenderer.invoke('usage:clear'),
  listHistory: () => ipcRenderer.invoke('history:list'),
  deleteHistory: (id: string) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  chipClick: (action: 'annotate' | 'ask') => ipcRenderer.invoke('chip:click', action),
  chipHide: () => ipcRenderer.invoke('chip:hide'),
  panelReady: () => ipcRenderer.invoke('panel:ready'),
  panelClose: () => ipcRenderer.invoke('panel:close'),
  panelRegenerate: () => ipcRenderer.invoke('panel:regenerate'),
  panelAsk: (question: string) => ipcRenderer.invoke('panel:ask', question),
  panelSetPinned: (pinned: boolean) => ipcRenderer.invoke('panel:pin', pinned),
  panelSwitchModel: (payload: { providerId: string; model: string }) =>
    ipcRenderer.invoke('panel:switch-model', payload),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  on: (channel: EventChannel, callback: (payload: unknown) => void) => {
    if (!EVENT_CHANNELS.includes(channel)) return () => undefined
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('zhujie', api)
