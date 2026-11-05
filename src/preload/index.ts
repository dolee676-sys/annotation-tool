import { contextBridge, ipcRenderer } from 'electron'

const EVENT_CHANNELS = [
  'state:changed',
  'usage:changed',
  'history:changed',
  'history:compress-progress',
  'favorites:changed',
  'update:progress'
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
  listHistorySummaries: () => ipcRenderer.invoke('history:summaries'),
  compressHistory: () => ipcRenderer.invoke('history:compress'),
  deleteHistory: (id: string) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  listFavorites: () => ipcRenderer.invoke('favorites:list'),
  deleteFavorite: (id: string) => ipcRenderer.invoke('favorites:delete', id),
  clearFavorites: () => ipcRenderer.invoke('favorites:clear'),
  toggleHistoryFavorite: (id: string) => ipcRenderer.invoke('favorites:toggle-history', id),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openReleasePage: () => ipcRenderer.invoke('updates:open'),
  restartHook: () => ipcRenderer.invoke('hook:restart'),
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  on: (channel: EventChannel, callback: (payload: unknown) => void) => {
    if (!EVENT_CHANNELS.includes(channel)) return () => undefined
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('zhujie', api)
