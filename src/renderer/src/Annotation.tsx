import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PanelDone, PanelInit, PanelMode } from '../../shared/types'
import { formatCny } from '../../shared/pricing'

marked.setOptions({ gfm: true, breaks: true })

export function Chip(): JSX.Element {
  const [busy, setBusy] = useState<'annotate' | 'ask' | null>(null)

  const trigger = (action: 'annotate' | 'ask'): void => {
    if (busy) return
    setBusy(action)
    void window.zhujie.chipClick(action).finally(() => setBusy(null))
  }

  return (
    <div className="chip-host">
      <button
        className="chip"
        title="AI 注解这段文字"
        disabled={Boolean(busy)}
        onClick={() => trigger('annotate')}
      >
        <span className="chip-spark" aria-hidden="true" />
        <span>{busy === 'annotate' ? '读取中' : '注解'}</span>
      </button>
      <button
        className="chip ask"
        title="就这段文字向 AI 提问"
        disabled={Boolean(busy)}
        onClick={() => trigger('ask')}
      >
        <span className="chip-spark ask" aria-hidden="true" />
        <span>{busy === 'ask' ? '读取中' : '提问'}</span>
      </button>
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
  const [copied, setCopied] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)
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
      target.current = 'initial'
      stickToBottom.current = true
    })
    const offReset = window.zhujie.on('panel:reset', (payload: ResetPayload) => {
      setMode(payload.mode)
      setModel(payload.model)
      setInitialError('')
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
      if (event.key === 'Escape') void window.zhujie.panelClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offInit()
      offReset()
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
    const map = new Map<string, { providerId: string; name: string; models: string[] }>()
    for (const option of init?.options ?? []) {
      const group = map.get(option.providerId) ?? {
        providerId: option.providerId,
        name: option.providerName,
        models: []
      }
      if (!group.models.includes(option.model)) group.models.push(option.model)
      map.set(option.providerId, group)
    }
    return Array.from(map.values())
  }, [init])

  const current = init?.options.find((o) => o.model === model) ?? null
  const selectedValue = current ? `${current.providerId}::${current.model}` : ''

  const busy =
    initialStatus === 'waiting' ||
    initialStatus === 'streaming' ||
    followUps.some((item) => item.status === 'waiting' || item.status === 'streaming')
  const canAsk = !busy && (mode === 'ask' || initialStatus === 'done' || initialStatus === 'error')
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

  const placeholder = !canAsk
    ? mode === 'annotate' && (initialStatus === 'waiting' || initialStatus === 'streaming')
      ? '注解完成后可以继续提问…'
      : '回答中…'
    : mode === 'annotate'
      ? '对这段内容继续提问…'
      : followUps.length > 0
        ? '继续问这段文字…'
        : '想问这段文字什么？'

  const footerStatus = busy
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
                {group.models.map((name) => (
                  <option key={`${group.providerId}::${name}`} value={`${group.providerId}::${name}`}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
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
            ↻
          </button>
          <button className="icon-btn" title={copied ? '已复制' : '复制内容'} onClick={() => void copy()}>
            {copied ? '✓' : '⧉'}
          </button>
          <button className="icon-btn close" title="关闭" onClick={() => void window.zhujie.panelClose()}>
            ×
          </button>
        </div>
      </header>

      <div className="quote" title={init?.text ?? ''}>
        <div className="quote-label">
          选中的文字
          {init && init.contextChars > 0 ? (
            ' · 已结合上下文'
          ) : init?.contextEnabled ? (
            <span title="当前应用没有向系统暴露可选文本，本次只发送选中文字">
              {' '}
              · 未读取到上下文
            </span>
          ) : (
            ''
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
          onChange={(event) => setQuestion(event.target.value)}
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
        {init && init.contextChars > 0 && <span className="context-badge">结合上下文</span>}
        {pinnedOpen && <span className="pin-badge">已钉住</span>}
        {init?.localOnly && <span className="local-badge">仅本机</span>}
      </footer>
    </div>
  )
}
