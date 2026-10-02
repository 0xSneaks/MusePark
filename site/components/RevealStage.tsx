'use client'
import { useCallback, useMemo, useState } from 'react'
import { formatBrier, formatPct, type Verdict } from '@/lib/amp'
import type { Envelope, RevealData } from '@/lib/derive'
import { SIM_BANNER_TEXT } from './SimBanner'

const ARROW: Record<Verdict, string> = { BEAT: '▲', TIED: '=', LOST: '▼' }
const COIN_LABEL: Record<Verdict, string> = { BEAT: 'BEAT THE COIN', TIED: 'TIED THE COIN', LOST: 'LOST TO THE COIN' }
const CROWD_LABEL: Record<Verdict, string> = { BEAT: 'BEAT THE CROWD', TIED: 'TIED THE CROWD', LOST: 'LOST TO THE CROWD' }
const tone = (v: Verdict) => (v === 'BEAT' ? 'win' : v === 'LOST' ? 'lose' : 'tie')
const HEX: Record<Verdict, string> = { BEAT: '#39ff8f', TIED: '#8a968f', LOST: '#ff4d5e' }

function drawShareCard(env: Envelope, scenario: string, outcome: string): string {
  const W = 1080
  const H = 1080
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  if (!g) return ''
  const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  g.fillStyle = '#050706'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#ffb000'
  g.fillRect(0, 0, W, 64)
  g.fillStyle = '#120c00'
  g.font = `800 26px ${mono}`
  g.textAlign = 'center'
  g.fillText(SIM_BANNER_TEXT.toUpperCase(), W / 2, 42)
  g.strokeStyle = '#2e3d35'
  g.lineWidth = 2
  g.strokeRect(48, 112, W - 96, H - 200)
  g.textAlign = 'left'
  g.fillStyle = '#39ff8f'
  g.font = `800 40px ${mono}`
  g.fillText('> MUSE PARK // REVEAL NIGHT', 88, 180)
  g.fillStyle = '#7d8b83'
  g.font = `400 28px ${mono}`
  g.fillText(`CASE #${env.index}   OUTCOME ${outcome}`, 88, 232)
  g.fillStyle = '#d7e2db'
  g.font = `800 200px ${mono}`
  g.fillText(formatPct(env.p_ppm), 80, 470)
  g.fillStyle = '#4fd8ff'
  g.font = `600 40px ${mono}`
  g.fillText(env.brier ? `BRIER ${formatBrier(BigInt(env.brier))}` : 'NOT SCORED (INVALID)', 88, 550)
  const rows: [Verdict, string][] = []
  if (env.coin) rows.push([env.coin, COIN_LABEL[env.coin]])
  if (env.crowd) rows.push([env.crowd, CROWD_LABEL[env.crowd]])
  rows.forEach(([v, text], i) => {
    g.fillStyle = HEX[v]
    g.font = `800 52px ${mono}`
    g.fillText(`${ARROW[v]} ${text}`, 88, 670 + i * 90)
  })
  g.fillStyle = '#7d8b83'
  g.font = `400 24px ${mono}`
  g.fillText(`scenario: ${scenario}`, 88, H - 120)
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
    <div className="grid">
      <div className="card">
        <div className="panel-title">
          <span>Ending · arbitration.json</span>
          <b className={s.scored ? 'up' : 'flat'}>{s.settled ? `${s.outcome} / ${s.reason}` : `UNSETTLED / ${s.reason}`}</b>
        </div>
        <label htmlFor="scenario" className="sr-only">Ending</label>
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
        {s.scored ? (
          <div className="table-wrap" style={{ marginTop: '0.6rem' }}>
            <table>
              <thead>
                <tr><th scope="col">Baseline</th><th scope="col" className="num">p (YES)</th><th scope="col" className="num">Brier</th></tr>
              </thead>
              <tbody>
                <tr><td>Coin</td><td className="num">{formatPct(data.coin_p_ppm)}</td><td className="num">{formatBrier(BigInt(view.coin_brier!))}</td></tr>
                <tr><td>Crowd (closing pool)</td><td className="num">{formatPct(data.pool.p_ppm)}</td><td className="num">{formatBrier(BigInt(view.pool_brier!))}</td></tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted" style={{ marginTop: '0.6rem' }}>Only YES/NO markets are scored (SPEC §11). This ending leaves every slot unscored.</p>
        )}
        <div style={{ marginTop: '0.6rem' }}>
          <button type="button" className="btn" onClick={() => setOpen(allOpen ? new Set() : new Set(view.envelopes.map((e) => e.index)))}>
            {allOpen ? 'Reseal all' : 'Break all seals'}
          </button>
        </div>
      </div>

      <div className="reveal-grid" role="list">
        {view.envelopes.map((e) => {
          const isOpen = open.has(e.index)
          return (
            <div role="listitem" key={e.index} style={{ background: 'var(--surface)' }}>
              <button
                type="button"
                className={`slot${isOpen ? ' open' : ''}`}
                aria-pressed={isOpen}
                aria-label={isOpen ? `Case ${e.index}: forecast ${formatPct(e.p_ppm)}` : `Sealed case ${e.index}. Break the seal.`}
                onClick={() => toggle(e.index)}
              >
                <span className="slot-head">
                  <span>Case #{e.index}</span>
                  <span className="slot-state">{isOpen ? '● REVEALED' : '■ SEALED'}</span>
                </span>
                <span className="slot-sealed">
                  <span className="slot-hash">commit {e.commitment.slice(0, 24)}…</span>
                  <span className="slot-redact" aria-hidden="true">00.00%</span>
                </span>
                <span className="slot-body" aria-live="polite">
                  <span className="slot-p" style={{ display: 'block' }}>{formatPct(e.p_ppm)}</span>
                  <span className="slot-row">
                    <span className="mono">{e.brier ? `BRIER ${formatBrier(BigInt(e.brier))}` : 'NOT SCORED'}</span>
                    {e.coin && <span className={`mark ${tone(e.coin)}`}>{ARROW[e.coin]} {COIN_LABEL[e.coin]}</span>}
                    {e.crowd && <span className={`mark ${tone(e.crowd)}`}>{ARROW[e.crowd]} {CROWD_LABEL[e.crowd]}</span>}
                  </span>
                </span>
              </button>
              {isOpen && (
                <button type="button" className="share" onClick={() => share(e)}>
                  ↓ Save share card
                </button>
              )}
            </div>
          )
        })}
      </div>

      {summary && allOpen && (
        <p className="note" aria-live="polite">
          <span className="up">{summary.beatCoin}/{summary.total}</span> beat the coin · <span className="up">{summary.beatCrowd}/{summary.total}</span> beat the crowd
        </p>
      )}
    </div>
  )
}
