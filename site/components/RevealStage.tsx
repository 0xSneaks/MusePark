'use client'
import { useCallback, useMemo, useState } from 'react'
import { formatBrier, formatPct, short, type Verdict } from '@/lib/amp'
import type { Envelope, RevealData } from '@/lib/derive'
import { SIM_BANNER_TEXT } from './SimBanner'

const COIN_LABEL: Record<Verdict, string> = { BEAT: 'Beat the coin', TIED: 'Tied the coin', LOST: 'Lost to the coin' }
const CROWD_LABEL: Record<Verdict, string> = { BEAT: 'Beat the crowd', TIED: 'Tied the crowd', LOST: 'Lost to the crowd' }
const tone = (v: Verdict) => (v === 'BEAT' ? 'win' : v === 'LOST' ? 'lose' : 'tie')

function drawShareCard(env: Envelope, scenario: string, outcome: string): string {
  const W = 1080
  const H = 1080
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (!g) return ''
  g.fillStyle = '#f3e9d2'
  g.fillRect(0, 0, W, H)
  g.strokeStyle = '#a87a1c'
  g.lineWidth = 16
  g.strokeRect(40, 40, W - 80, H - 80)
  g.fillStyle = '#1d1a16'
  g.textAlign = 'center'
  g.font = '700 64px Georgia, serif'
  g.fillText('Muse Park · Reveal Night', W / 2, 170)
  g.font = '400 34px Georgia, serif'
  g.fillText(`Conformance case #${env.index} · outcome ${outcome}`, W / 2, 230)
  g.font = '700 220px Georgia, serif'
  g.fillText(formatPct(env.p_ppm), W / 2, 500)
  g.font = '400 40px ui-monospace, monospace'
  g.fillText(env.brier ? `Brier ${formatBrier(BigInt(env.brier))}` : 'Not scored (INVALID)', W / 2, 590)
  const stamps: [string, string][] = []
  if (env.coin) stamps.push([COIN_LABEL[env.coin].toUpperCase(), env.coin === 'BEAT' ? '#1f7a4d' : env.coin === 'LOST' ? '#a3262a' : '#6b6152'])
  if (env.crowd) stamps.push([CROWD_LABEL[env.crowd].toUpperCase(), env.crowd === 'BEAT' ? '#1f7a4d' : env.crowd === 'LOST' ? '#a3262a' : '#6b6152'])
  stamps.forEach(([text, color], i) => {
    g.save()
    g.translate(W / 2, 700 + i * 110)
    g.rotate(-0.06)
    g.strokeStyle = color
    g.fillStyle = color
    g.lineWidth = 8
    g.font = '800 52px system-ui, sans-serif'
    const w = g.measureText(text).width + 60
    g.strokeRect(-w / 2, -55, w, 80)
    g.fillText(text, 0, 5)
    g.restore()
  })
  g.fillStyle = '#5a4300'
  g.font = '700 28px system-ui, sans-serif'
  g.fillText(SIM_BANNER_TEXT, W / 2, H - 120)
  g.font = '400 24px ui-monospace, monospace'
  g.fillText(`scenario: ${scenario}`, W / 2, H - 80)
  return c.toDataURL('image/png')
}

export function RevealStage({ data, initial }: { data: RevealData; initial: string }) {
  const [scenario, setScenario] = useState(initial)
  const [open, setOpen] = useState<Set<number>>(new Set())
  const s = data.scenarios.find((x) => x.name === scenario)!
  const view = data.byScenario[scenario]
  const allOpen = open.size === view.envelopes.length

  const toggle = useCallback((i: number) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }, [])

  const summary = useMemo(() => {
    if (!view.coin_brier) return null
    const beatCoin = view.envelopes.filter((e) => e.coin === 'BEAT').length
    const beatCrowd = view.envelopes.filter((e) => e.crowd === 'BEAT').length
    return { beatCoin, beatCrowd, total: view.envelopes.length }
  }, [view])

  const share = (env: Envelope) => {
    const url = drawShareCard(env, scenario, s.outcome ?? 'n/a')
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `musepark-reveal-case-${env.index}-${scenario}.png`
    a.click()
  }

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="card">
        <label htmlFor="scenario" className="kicker" style={{ display: 'block' }}>
          Ending (from arbitration.json)
        </label>
        <select
          id="scenario"
          value={scenario}
          onChange={(e) => {
            setScenario(e.target.value)
            setOpen(new Set())
          }}
        >
          {data.scenarios.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name} — {x.settled ? `${x.outcome} (${x.reason})` : `not settled (${x.reason})`}
            </option>
          ))}
        </select>
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          {s.scored ? (
            <>
              Settled <strong>{s.outcome}</strong>. Coin (50%) scores {formatBrier(BigInt(view.coin_brier!))}; the crowd (closing pool,{' '}
              {formatPct(data.pool.p_ppm)} YES) scores {formatBrier(BigInt(view.pool_brier!))}. Lower is better.
            </>
          ) : (
            <>This ending is {s.settled ? `${s.outcome} (${s.reason})` : `not settled (${s.reason})`}. Only YES/NO markets are scored (SPEC §11), so the seals stay meaningless here.</>
          )}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => setOpen(allOpen ? new Set() : new Set(view.envelopes.map((e) => e.index)))}>
            {allOpen ? 'Reseal all' : 'Break all seals'}
          </button>
        </div>
      </div>

      <div className="envelopes" role="list">
        {view.envelopes.map((e) => {
          const isOpen = open.has(e.index)
          return (
            <div role="listitem" key={e.index}>
              <button
                type="button"
                className={`envelope${isOpen ? ' open' : ''}`}
                aria-pressed={isOpen}
                aria-label={isOpen ? `Case ${e.index}: forecast ${formatPct(e.p_ppm)}` : `Sealed case ${e.index}, commitment ${short(e.commitment)}. Break the seal.`}
                onClick={() => toggle(e.index)}
              >
                <span className="flap" aria-hidden="true" />
                <span className="seal" aria-hidden="true"><span className="seal-label">#{e.index}</span></span>
                <span className="commit" aria-hidden="true">{short(e.commitment, 8)}</span>
                <span className="inside" aria-live="polite">
                  <span className="p">{formatPct(e.p_ppm)}</span>
                  <span className="small mono">{e.brier ? `Brier ${formatBrier(BigInt(e.brier))}` : 'not scored'}</span>
                  <span className="stamps">
                    {e.coin && <span className={`stamp ${tone(e.coin)}`}>{COIN_LABEL[e.coin]}</span>}
                    {e.crowd && <span className={`stamp ${tone(e.crowd)}`}>{CROWD_LABEL[e.crowd]}</span>}
                  </span>
                </span>
              </button>
              {isOpen && (
                <button type="button" className="btn ghost" style={{ width: '100%', marginTop: '0.35rem', minHeight: 40 }} onClick={() => share(e)}>
                  Save share card
                </button>
              )}
            </div>
          )
        })}
      </div>

      {summary && allOpen && (
        <p className="note" aria-live="polite">
          {summary.beatCoin} of {summary.total} envelopes beat the coin; {summary.beatCrowd} of {summary.total} beat the crowd.
        </p>
      )}
    </div>
  )
}
