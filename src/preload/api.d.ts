import type {
  AppEntry,
  AppState,
  HistoryCompressProgress,
  HistoryCompressResult,
  HistoryRecord,
  HistorySummary,
  PanelDone,
  PanelError,
  PanelContext,
  PanelInit,
  PanelModelOption,
  ProviderPatch,
  SettingsPatch,
  TestProviderResult,
  UsageSummary
} from '../shared/types'

export interface PanelReset {
  mode: 'annotate' | 'ask'
  followUp?: boolean
  question?: string
  providerId: string
  providerName: string
  model: string
  localOnly: boolean
}

export interface ZhujieApi {
  getState(): Promise<AppState>
  listApps(force?: boolean): Promise<AppEntry[]>
  updateSettings(patch: SettingsPatch): Promise<AppState>
  saveProvider(patch: ProviderPatch): Promise<AppState>
  removeProvider(id: string): Promise<AppState>
  testProvider(id: string): Promise<TestProviderResult>
  getUsage(): Promise<UsageSummary>
  clearUsage(): Promise<UsageSummary>
  listHistory(): Promise<HistoryRecord[]>
  listHistorySummaries(): Promise<HistorySummary[]>
  compressHistory(): Promise<HistoryCompressResult>
  deleteHistory(id: string): Promise<HistoryRecord[]>
  clearHistory(): Promise<HistoryRecord[]>
  writeClipboard(text: string): Promise<boolean>
  chipClick(action: 'annotate' | 'ask'): Promise<boolean>
  panelReady(): Promise<boolean>
  panelClose(): Promise<boolean>
  panelRegenerate(): Promise<boolean>
  panelAsk(question: string): Promise<boolean>
  panelSetPinned(pinned: boolean): Promise<boolean>
  panelSwitchModel(payload: { providerId: string; model: string }): Promise<boolean>
  minimizeWindow(): Promise<boolean>
  hideWindow(): Promise<boolean>
  on(channel: 'state:changed', callback: (payload: AppState) => void): () => void
  on(channel: 'usage:changed', callback: () => void): () => void
  on(channel: 'panel:init', callback: (payload: PanelInit) => void): () => void
  on(channel: 'panel:reset', callback: (payload: PanelReset) => void): () => void
  on(channel: 'panel:context', callback: (payload: PanelContext) => void): () => void
  on(channel: 'panel:delta', callback: (payload: { chunk: string }) => void): () => void
  on(channel: 'panel:done', callback: (payload: PanelDone) => void): () => void
  on(channel: 'panel:error', callback: (payload: PanelError) => void): () => void
  on(channel: 'history:changed', callback: () => void): () => void
  on(
    channel: 'history:compress-progress',
    callback: (payload: HistoryCompressProgress) => void
  ): () => void
}

declare global {
  interface Window {
    zhujie: ZhujieApi
  }
}

export type { PanelModelOption }
