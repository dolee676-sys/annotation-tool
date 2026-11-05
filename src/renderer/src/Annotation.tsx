import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PanelDone, PanelInit, PanelMode } from '../../shared/types'
import { formatCny, formatUsageMultiplier } from '../../shared/pricing'

marked.setOptions({ gfm: true, breaks: true })

export function Chip(): JSX.Element {
  const [busy, setBusy] = useState<'annotate' | 'ask' | null>(null)
  const [appearId, setAppearId] = useState(0)

  useEffect(() => window.zhujie.onAppear(() => setAppearId((value) => value + 1)), [])

  const trigger = (action: 'annotate' | 'ask'): void => {
    if (busy) return
    setBusy(action)
    void window.zhujie.chipClick(action).finally(() => setBusy(null))
  }

  return (
    <div className="chip-host" key={appearId}>
      <div className={busy ? 'chip-shell busy' : 'chip-shell'}>
        <button
          className="chip-half left"
          title="AI 注解这段文字"
          aria-label="注解"
          disabled={Boolean(busy)}
          onClick={() => trigger('annotate')}
        >
          注
        </button>
        <button
          className="chip-half right"
          title="就这段文字向 AI 提问"
          aria-label="提问"
          disabled={Boolean(busy)}
          onClick={() => trigger('ask')}
        >
          问
        </button>
      </div>
    </div>
  )
}

type Status = 'idle' | 'waiting' | 'streaming' | 'done' | 'error'

interface ResetPayload {
  mode: PanelMode
  followUp?: boolean
  question?: string
  providerId: string
  providerName: string
  model: string
  localOnly: boolean
}

interface FollowUp {
  id: number
  question: string
  answer: string
  status: Status
  error: string
  meta: PanelDone | null
}

function Markdown({ text }: { text: string }): JSX.Element {
  const html = useMemo(
    () => (text ? DOMPurify.sanitize(marked.parse(text) as string) : ''),
    [text]
  )
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

function MetaLine({ meta }: { meta: PanelDone }): JSX.Element {
  return (
    <div className="block-meta">
      {meta.usage.estimated ? '≈' : ''}
      {meta.usage.totalTokens.toLocaleString()} tokens · {formatCny(meta.cost)} ·{' '}
      {Math.max(1, Math.round(meta.latencyMs / 100) / 10)}s
    </div>
  )
}

export function Panel(): JSX.Element {
  const [init, setInit] = useState<PanelInit | null>(null)
  const [mode, setMode] = useState<PanelMode>('annotate')
  const [model, setModel] = useState('')
  const [initialAnswer, setInitialAnswer] = useState('')
  const [initialStatus, setInitialStatus] = useState<Status>('waiting')
  const [initialError, setInitialError] = useState('')
  const [initialMeta, setInitialMeta] = useState<PanelDone | null>(null)
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [question, setQuestion] = useState('')
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [favorited, setFavorited] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [favoriteError, setFavoriteError] = useState('')
  const [copied, setCopied] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const stickToBottom = useRef(true)
  const readySent = useRef(false)
  const target = useRef<'initial' | 'followup'>('initial')
  const nextFollowUpId = useRef(1)

  useEffect(() => {
    const offInit = window.zhujie.on('panel:init', (payload: PanelInit) => {
      setInit(payload)
      setMode(payload.mode)
      setModel(payload.model)
      setInitialAnswer('')
      setInitialError('')
      setInitialMeta(null)
      setInitialStatus(payload.mode === 'ask' ? 'idle' : 'waiting')
      setFollowUps([])
      setQuestion('')
      setPinnedOpen(false)
      setFavorited(false)
      setFavoriteError('')
      target.current = 'initial'
      stickToBottom.current = true
    })
    const offReset = window.zhujie.on('panel:reset', (payload: ResetPayload) => {
      setMode(payload.mode)
      setModel(payload.model)
      setInitialError('')
      setFavorited(false)
      setFavoriteError('')
      if (payload.followUp) {
        target.current = 'followup'
        setFollowUps((prev) => [
          ...prev,
          {
            id: nextFollowUpId.current++,
            question: payload.question ?? '',
            answer: '',
            status: 'waiting',
            error: '',
            meta: null
          }
        ])
        setQuestion('')
      } else {
        target.current = 'initial'
        setInitialAnswer('')
        setInitialMeta(null)
        setInitialStatus(payload.mode === 'ask' ? 'idle' : 'waiting')
        setFollowUps([])
        setQuestion('')
      }
      stickToBottom.current = true
    })
    const offContext = window.zhujie.on('panel:context', (payload) => {
      setInit((prev) => (prev ? { ...prev, ...payload } : prev))
    })
    const offDelta = window.zhujie.on('panel:delta', ({ chunk }: { chunk: string }) => {
      if (target.current === 'followup') {
        setFollowUps((prev) => {
          if (prev.length === 0) return prev
          const next = [...prev]
          const last = { ...next[next.length - 1] }
          last.answer += chunk
          last.status = 'streaming'
          next[next.length - 1] = last
          return next
        })
      } else {
        setInitialAnswer((prev) => prev + chunk)
        setInitialStatus('streaming')
      }
    })
    const offDone = window.zhujie.on('panel:done', (payload: PanelDone) => {
      if (target.current === 'followup') {
        setFollowUps((prev) => {
          if (prev.length === 0) return prev
          const next = [...prev]
          const last = { ...next[next.length - 1] }
          last.status = 'done'
          last.meta = payload
          next[next.length - 1] = last
          return next
        })
      } else {
        setInitialMeta(payload)
        setInitialStatus('done')
      }
    })
    const offError = window.zhujie.on('panel:error', ({ message }: { message: string }) => {
      if (target.current === 'followup') {
        setFollowUps((prev) => {
          if (prev.length === 0) return prev
          const next = [...prev]
          const last = { ...next[next.length - 1] }
          last.status = 'error'
          last.error = message
          next[next.length - 1] = last
          return next
        })
      } else {
        setInitialError(message)
        setInitialStatus('error')
      }
    })

    if (!readySent.current) {
      readySent.current = true
      void window.zhujie.panelReady()
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) {
        void window.zhujie.panelClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offInit()
      offReset()
      offContext()
      offDelta()
      offDone()
      offError()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    const el = answerRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [initialAnswer, followUps])

  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        providerId: string
        name: string
        models: Array<{ name: string; free: boolean; multiplier?: number | null }>
      }
    >()
    for (const option of init?.options ?? []) {
      const group = map.get(option.providerId) ?? {
        providerId: option.providerId,
        name: option.providerName,
        models: []
      }
      if (!group.models.some((item) => item.name === option.model)) {
        group.models.push({
          name: option.model,
          free: Boolean(option.free),
          multiplier: option.multiplier
        })
      }
      map.set(option.providerId, group)
    }
    return Array.from(map.values())
  }, [init])

  const current =
    init?.options.find((o) => o.providerId === init.providerId && o.model === model) ?? null
  const selectedValue = current ? `${current.providerId}::${current.model}` : ''

  const busy =
    initialStatus === 'waiting' ||
    initialStatus === 'streaming' ||
    followUps.some((item) => item.status === 'waiting' || item.status === 'streaming')
  const contextPending = Boolean(init?.contextPending)
  const canAsk =
    !busy &&
    !contextPending &&
    (mode === 'ask' || initialStatus === 'done' || initialStatus === 'error')
  const lastFollowUp = followUps[followUps.length - 1]
  const canFavorite =
    !busy && (lastFollowUp ? lastFollowUp.status === 'done' : initialStatus === 'done')

  const toggleFavorite = async (): Promise<void> => {
    if (!canFavorite || favoriteBusy) return
    setFavoriteBusy(true)
    setFavoriteError('')
    try {
      const result = await window.zhujie.panelFavorite()
      if (result.ok) setFavorited(result.favorited)
      else setFavoriteError(result.error ?? '收藏失败')
    } finally {
      setFavoriteBusy(false)
    }
  }
  const latestMeta = followUps.length ? followUps[followUps.length - 1].meta : initialMeta
  const latestStatus = followUps.length ? followUps[followUps.length - 1].status : initialStatus

  const copy = async (): Promise<void> => {
    const parts = [initialAnswer, ...followUps.map((item) => item.answer)].filter(Boolean)
    await window.zhujie.writeClipboard(parts.join('\n\n---\n\n') || init?.text || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const togglePin = (): void => {
    const next = !pinnedOpen
    setPinnedOpen(next)
    void window.zhujie.panelSetPinned(next)
  }

  const submitAsk = (): void => {
    if (composing.current) return
    const text = question.trim()
    if (!text || !canAsk) return
    setQuestion('')
    stickToBottom.current = true
    void window.zhujie.panelAsk(text)
  }

  const retryFollowUp = (item: FollowUp): void => {
    setFollowUps((prev) => prev.filter((entry) => entry.id !== item.id))
    stickToBottom.current = true
    void window.zhujie.panelAsk(item.question)
  }

  const placeholder = contextPending
    ? '正在读取上下文…'
    : !canAsk
      ? mode === 'annotate' && (initialStatus === 'waiting' || initialStatus === 'streaming')
        ? '注解完成后可以继续提问…'
        : '回答中…'
      : mode === 'annotate'
        ? '对这段内容继续提问…'
        : followUps.length > 0
          ? '继续问这段文字…'
          : '想问这段文字什么？'

  const footerStatus = contextPending
    ? '正在读取上下文'
    : busy
      ? initialStatus === 'waiting' && followUps.length === 0
        ? '正在解析'
        : '正在回答'
      : latestStatus === 'done'
        ? '已记录用量'
        : latestStatus === 'error'
          ? '未完成'
          : mode === 'ask' && followUps.length === 0
            ? '等你提问'
            : '准备中'

  return (
    <div className="panel">
      <header className="panel-head">
        <div className="panel-title">
          <span className={mode === 'ask' ? 'panel-mark ask' : 'panel-mark'} aria-hidden="true" />
          <div>
            <strong>{mode === 'ask' ? '提问' : '注解'}</strong>
            <span className="panel-source">
              {init?.programName ? `来自 ${init.programName}` : 'AI 解析'}
            </span>
          </div>
        </div>
        <div className="panel-actions">
          <select
            className="model-select"
            value={selectedValue}
            onChange={(event) => {
              const [providerId, ...rest] = event.target.value.split('::')
              const nextModel = rest.join('::')
              if (providerId && nextModel) {
                void window.zhujie.panelSwitchModel({ providerId, model: nextModel })
              }
            }}
            title="切换模型"
          >
            {!selectedValue && <option value="">选择模型</option>}
            {groups.map((group) => (
              <optgroup key={group.providerId} label={group.name}>
                {group.models.map((item) => (
                  <option
                    key={`${group.providerId}::${item.name}`}
                    value={`${group.providerId}::${item.name}`}
                  >
                    {item.name}
                    {item.free || item.multiplier === 0
                      ? '（免费）'
                      : item.multiplier != null
                        ? `（${formatUsageMultiplier(item.multiplier)}）`
                        : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            className={favorited ? 'icon-btn star active' : 'icon-btn star'}
            title={favorited ? '取消收藏' : '收藏当前问答'}
            disabled={!canFavorite || favoriteBusy}
            onClick={() => void toggleFavorite()}
          >
            <svg
              viewBox="0 0 24 24"
              fill={favorited ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            >
              <path d="M12 3.2l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9L12 3.2z" />
            </svg>
          </button>
          <button
            className={pinnedOpen ? 'icon-btn pin active' : 'icon-btn pin'}
            title={pinnedOpen ? '取消钉住，点外部可关闭' : '钉在当前屏幕上'}
            onClick={togglePin}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
              <path d="M12 14v7" />
            </svg>
          </button>
          <button
            className="icon-btn"
            title={
              mode === 'ask'
                ? '提问模式请直接重新提问'
                : followUps.length > 0
                  ? '重新生成注解（会清空追问）'
                  : '重新生成注解'
            }
            disabled={mode === 'ask' || busy}
            onClick={() => void window.zhujie.panelRegenerate()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 11a8 8 0 1 0-2.4 5.7" />
              <path d="M20 4v7h-7" />
            </svg>
          </button>
          <button className="icon-btn" title={copied ? '已复制' : '复制内容'} onClick={() => void copy()}>
            {copied ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4 4L19 7" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="10" height="10" rx="2" />
                <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
              </svg>
            )}
          </button>
          <button className="icon-btn close" title="关闭" onClick={() => void window.zhujie.panelClose()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      <div className="quote" title={init?.text ?? ''}>
        <div className="quote-label">
          选中的文字
          {init?.contextPending ? (
            ' · 正在读取上下文…'
          ) : init && init.contextChars > 0 ? (
            ' · 已结合上下文'
          ) : init?.contextEnabled ? (
            <span title="当前应用没有向系统暴露可选文本，本次只发送选中文字">
              {' '}
              · 未读取到上下文
            </span>
          ) : (
            ''
          )}
          {init?.truncated && (
            <span className="quote-warn">
              {' '}
              · 已截断，仅发送前 {init.maxChars} 字
            </span>
          )}
        </div>
        <p>{init?.text ?? ''}</p>
        {init?.text && init.text.length > 120 && <div className="quote-fade" aria-hidden="true" />}
      </div>

      <div
        className="answer"
        ref={answerRef}
        onScroll={(event) => {
          const el = event.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 36
        }}
      >
        {mode === 'ask' && initialStatus === 'idle' && followUps.length === 0 && (
          <div className="ask-hint">在下面输入你的问题，AI 会结合这段文字回答。</div>
        )}

        {initialStatus !== 'idle' && (
          <div className="conversation-block">
            {initialStatus === 'waiting' && (
              <div className="skeleton" aria-label="正在生成注解">
                <span style={{ width: '62%' }} />
                <span style={{ width: '94%' }} />
                <span style={{ width: '88%' }} />
                <span style={{ width: '46%' }} />
              </div>
            )}
            {initialStatus === 'error' ? (
              <div className="error-card">
                <div className="error-title">没能完成注解</div>
                <p>{initialError}</p>
                <div className="error-actions">
                  <button onClick={() => void window.zhujie.panelRegenerate()}>重试</button>
                  <button className="ghost" onClick={() => void window.zhujie.panelClose()}>
                    关闭
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Markdown text={initialAnswer} />
                {initialStatus === 'streaming' && <span className="caret" aria-hidden="true" />}
                {initialMeta && <MetaLine meta={initialMeta} />}
              </>
            )}
          </div>
        )}

        {followUps.map((item, index) => (
          <div
            className={index === 0 && mode === 'ask' ? 'followup first' : 'followup'}
            key={item.id}
          >
            <div className="followup-question">
              <span>你的问题</span>
              <p>{item.question}</p>
            </div>
            {item.status === 'waiting' && (
              <div className="skeleton" aria-label="正在回答">
                <span style={{ width: '58%' }} />
                <span style={{ width: '90%' }} />
                <span style={{ width: '72%' }} />
              </div>
            )}
            {item.status === 'error' ? (
              <div className="error-card">
                <div className="error-title">没能完成回答</div>
                <p>{item.error}</p>
                <div className="error-actions">
                  <button onClick={() => retryFollowUp(item)}>重试</button>
                </div>
              </div>
            ) : (
              <>
                <Markdown text={item.answer} />
                {item.status === 'streaming' && <span className="caret" aria-hidden="true" />}
                {item.meta && <MetaLine meta={item.meta} />}
              </>
            )}
          </div>
        ))}
      </div>

      <form
        className="ask-bar"
        onSubmit={(event) => {
          event.preventDefault()
          submitAsk()
        }}
      >
        <input
          value={question}
          placeholder={placeholder}
          maxLength={4000}
          onChange={(event) => setQuestion(event.target.value)}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) {
              event.preventDefault()
            }
          }}
          disabled={!canAsk}
        />
        <button type="submit" disabled={!question.trim() || !canAsk}>
          提问
        </button>
      </form>

      <footer className="panel-foot">
        <span className={`live-dot ${busy ? 'on' : ''}`} aria-hidden="true" />
        <span>{footerStatus}</span>
        {latestMeta && (
          <span className="foot-meta">
            {latestMeta.usage.estimated ? '≈' : ''}
            {latestMeta.usage.totalTokens.toLocaleString()} tokens · {formatCny(latestMeta.cost)} ·{' '}
            {Math.max(1, Math.round(latestMeta.latencyMs / 100) / 10)}s
          </span>
        )}
        <span className="foot-spacer" />
        {favoriteError && <span className="quote-warn">{favoriteError}</span>}
        {init && init.contextChars > 0 && <span className="context-badge">结合上下文</span>}
        {pinnedOpen && <span className="pin-badge">已钉住</span>}
        {init?.localOnly && <span className="local-badge">仅本机</span>}
      </footer>
    </div>
  )
}
