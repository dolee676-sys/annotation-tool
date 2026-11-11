/**
 * 从 App.tsx 抽出的独立小组件：Icon、MultiplierBadge、FavoriteCard、SummaryCard、
 * ProviderCard。只接收 props，不读 App 的 state，渲染与抽出前一致。
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo, useState } from 'react'
import type { FavoriteRecord, HistorySummary, ProviderView } from '../../shared/types'
import { formatCny, formatUsageMultiplier, usageMultiplier } from '../../shared/pricing'
import { presetById } from '../../shared/presets'
import { modelDisplayName } from '../../shared/modelCatalog'
import { t } from './i18n'
import { fmtTime } from './utils'

marked.setOptions({ gfm: true, breaks: true })

export interface TestState {
  loading?: boolean
  ok?: boolean
  error?: string
  models?: number
}

export function Icon({ name }: { name: string }): JSX.Element {
  const paths: Record<string, JSX.Element> = {
    apps: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.6" />
        <rect x="14" y="3" width="7" height="7" rx="1.6" />
        <rect x="3" y="14" width="7" height="7" rx="1.6" />
        <rect x="14" y="14" width="7" height="7" rx="1.6" />
      </>
    ),
    chip: (
      <>
        <rect x="5" y="5" width="14" height="14" rx="3" />
        <path d="M9 9h6M9 12h6M9 15h3" />
      </>
    ),
    text: (
      <>
        <path d="M4 6h16M4 11h12M4 16h15M4 21h8" />
      </>
    ),
    bars: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20v-4" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v6M12 7.2v.2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
    star: (
      <path d="M12 3.2l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9L12 3.2z" />
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      {paths[name] ?? paths.info}
    </svg>
  )
}

export function MultiplierBadge({ value }: { value: number | null }): JSX.Element | null {
  if (value === null) {
    return (
      <span className="multiplier unknown" title={t('未收录该模型价格，暂不比较')}>
        —
      </span>
    )
  }
  const tone = value === 0 ? 'free' : value < 0.5 ? 'low' : value <= 2 ? 'mid' : 'high'
  return (
    <span
      className={`multiplier ${tone}`}
      title={t('相对 deepseek-flash 的 token 价格；按每百万 tokens 输入+输出估算，实际以用量页为准')}
    >
      {formatUsageMultiplier(value)}
    </span>
  )
}

export function FavoriteCard({
  favorite,
  onDelete
}: {
  favorite: FavoriteRecord
  onDelete: () => void
}): JSX.Element {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(favorite.answer) as string),
    [favorite.answer]
  )
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    await window.zhujie.writeClipboard(favorite.answer)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <article className="favorite-card">
      <div className="favorite-head">
        <div className="favorite-meta">
          <span className={favorite.mode === 'ask' ? 'history-mode ask' : 'history-mode'}>
            {favorite.mode === 'ask' ? t('提问') : t('注解')}
          </span>
          <span className="muted">
            {fmtTime(favorite.ts)} · {favorite.programName} · {favorite.model}
          </span>
        </div>
        <div className="favorite-actions">
          <button className="link" onClick={() => void copy()}>
            {copied ? t('已复制') : t('复制回答')}
          </button>
          <button className="link danger" onClick={onDelete}>
            {t('删除')}
          </button>
        </div>
      </div>
      <div className="favorite-question">
        <span>{favorite.question ? t('你的问题') : t('选中的文字')}</span>
        <p>{favorite.question || favorite.text}</p>
      </div>
      <div className="favorite-answer markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="favorite-foot">
        {favorite.totalTokens.toLocaleString()} tokens · {formatCny(favorite.cost)}
        {favorite.contextChars
          ? ` · ${t('结合上下文 {count} 字', { count: favorite.contextChars })}`
          : ''}
      </div>
    </article>
  )
}

export function SummaryCard({ summary }: { summary: HistorySummary }): JSX.Element {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(summary.summary) as string),
    [summary.summary]
  )
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    await window.zhujie.writeClipboard(summary.summary)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <details className="summary-card" open>
      <summary>
        <span className="history-mode summary">{t('综合')}</span>
        <span className="summary-title">{t('{count} 条记录', { count: summary.sourceCount })}</span>
        <span className="summary-meta">
          {fmtTime(summary.fromTs)} – {fmtTime(summary.toTs)} · {summary.model}
        </span>
      </summary>
      <div className="summary-body markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="summary-foot">
        <span>
          {summary.providerName} · {summary.totalTokens.toLocaleString()} tokens ·{' '}
          {formatCny(summary.cost)}
        </span>
        <button className="link" onClick={() => void copy()}>
          {copied ? t('已复制') : t('复制摘要')}
        </button>
      </div>
    </details>
  )
}

export interface ProviderCardProps {
  provider: ProviderView
  test?: TestState
  isDefault: boolean
  currentModel: string
  onTest: () => void
  onEdit: () => void
  onRemove: () => void
  onUseModel: (model: string) => void
}

export function ProviderCard({
  provider,
  test,
  isDefault,
  currentModel,
  onTest,
  onEdit,
  onRemove,
  onUseModel
}: ProviderCardProps): JSX.Element {
  const local = /^(http:\/\/)?(localhost|127\.0\.0\.1|\[::1\])/i.test(provider.baseUrl)
  const preset = presetById(provider.presetId ?? '')
  const hasFree = local || Boolean(preset?.free) || (preset?.freeModels?.length ?? 0) > 0
  return (
    <div className={isDefault ? 'provider-card default' : 'provider-card'}>
      <div className="provider-head">
        <div>
          <h3>
            {provider.name}
            {isDefault && <span className="pill accent">{t('默认')}</span>}
            <span className={local ? 'pill' : 'pill warn'}>
              {local ? t('本机') : t('外部')}
            </span>
            {hasFree && <span className="free-badge">{t('免费')}</span>}
          </h3>
          <code className="provider-url">{provider.baseUrl}</code>
        </div>
        <div className="provider-actions">
          <button className="ghost" onClick={onTest} disabled={test?.loading}>
            {test?.loading ? t('测试中…') : t('测试 / 拉取模型')}
          </button>
          <button className="ghost" onClick={onEdit}>
            {t('编辑')}
          </button>
          {!provider.builtin && (
            <button className="ghost danger" onClick={onRemove}>
              {t('删除')}
            </button>
          )}
        </div>
      </div>

      <div className="model-chips">
        {provider.models.length === 0 ? (
          <span className="muted">{t('尚未获取模型列表')}</span>
        ) : (
          provider.models.map((model) => (
            <button
              key={model}
              className={model === currentModel ? 'chip-model active' : 'chip-model'}
              onClick={() => onUseModel(model)}
              title={t('设为默认模型')}
            >
              {modelDisplayName(provider.presetId ?? provider.id, model)}
              <MultiplierBadge
                value={usageMultiplier({
                  model,
                  local,
                  fallbackIn: provider.priceIn,
                  fallbackOut: provider.priceOut,
                  useFallback: !provider.builtin
                })}
              />
            </button>
          ))
        )}
      </div>

      {test?.error && <p className="test-error">{test.error}</p>}
      {test?.ok && (
        <p className="test-ok">{t('连接正常，发现 {count} 个模型。', { count: test.models ?? 0 })}</p>
      )}
      {provider.hasKey && <span className="key-flag">{t('已保存 API Key')}</span>}
    </div>
  )
}
