import type {
  AppEntry,
  AppState,
  FavoriteRecord,
  FavoriteToggleResult,
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
  UpdateProgress,
  UpdateStatus,
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
  listFavorites(): Promise<FavoriteRecord[]>
  deleteFavorite(id: string): Promise<FavoriteRecord[]>
  clearFavorites(): Promise<FavoriteRecord[]>
  checkUpdates(): Promise<UpdateStatus>
  downloadUpdate(): Promise<UpdateStatus>
  installUpdate(): Promise<{ ok: boolean; error?: string }>
  openReleasePage(): Promise<boolean>
  restartHook(): Promise<AppState>
  writeClipboard(text: string): Promise<boolean>
  chipClick(action: 'annotate' | 'ask'): Promise<boolean>
  onAppear(callback: () => void): () => void
  panelReady(): Promise<boolean>
  panelClose(): Promise<boolean>
  panelRegenerate(): Promise<boolean>
  panelAsk(question: string): Promise<boolean>
  panelFavorite(): Promise<FavoriteToggleResult>
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
  on(channel: 'favorites:changed', callback: () => void): () => void
  on(channel: 'update:progress', callback: (payload: UpdateProgress) => void): () => void
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
