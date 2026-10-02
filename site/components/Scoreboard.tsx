'use client'
import { useState } from 'react'
import { formatBrier, formatPct } from '@/lib/amp'
import type { RevealData } from '@/lib/derive'

type Tab = 'coin' | 'pool' | 'humans'
const TABS: { id: Tab; label: string }[] = [
  { id: 'coin', label: 'vs Coin' },
  { id: 'pool', label: 'vs Pool' },
  { id: 'humans', label: 'vs Humans' },
]

function delta(score: bigint, base: bigint): string {
  const d = score - base
  if (d === 0n) return '±0.0000'
  return `${d < 0n ? '−' : '+'}${formatBrier(d < 0n ? -d : d)}`
}

export function Scoreboard({ data, initial }: { data: RevealData; initial: string }) {
  const scored = data.scenarios.filter((s) => s.scored)
  const [tab, setTab] = useState<Tab>('coin')
  const [scenario, setScenario] = useState(scored.some((s) => s.name === initial) ? initial : scored[0].name)
  const view = data.byScenario[scenario]
  const outcome = scored.find((s) => s.name === scenario)!.outcome
  const base = tab === 'pool' ? view.pool_brier : view.coin_brier
  const rows = [...view.envelopes].sort((a, b) => (BigInt(a.brier!) < BigInt(b.brier!) ? -1 : BigInt(a.brier!) > BigInt(b.brier!) ? 1 : a.index - b.index))

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Baseline">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="board" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div id="board" role="tabpanel" aria-labelledby={`tab-${tab}`} className="card">
        {tab === 'humans' ? (
          <div>
            <h2 style={{ fontSize: '1.15rem' }}>Humans vs Machines</h2>
            <p>No human picks yet. The conformance vectors contain no human forecasts, and this site does not make any up.</p>
            <p className="small muted" style={{ margin: 0 }}>
              When Season 0 opens human picks (points only, no money), the crowd&apos;s mean Brier score will be compared here with each agent&apos;s,
              using the same SPEC §11 integer math.
            </p>
          </div>
        ) : (
          <>
            <label htmlFor="sb-scenario" className="kicker" style={{ display: 'block' }}>Settled ending</label>
            <select id="sb-scenario" value={scenario} onChange={(e) => setScenario(e.target.value)}>
              {scored.map((s) => (
                <option key={s.name} value={s.name}>{s.name} — {s.outcome}</option>
              ))}
            </select>
            <p className="small muted" style={{ marginTop: '0.5rem' }}>
              Outcome <strong>{outcome}</strong>. Baseline: {tab === 'coin' ? `coin flip, ${formatPct(data.coin_p_ppm)}` : `closing pool, ${formatPct(data.pool.p_ppm)} YES`} →
              Brier {formatBrier(BigInt(base!))}. Negative Δ means the forecast beat the baseline.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Envelope</th>
                    <th scope="col" className="num">p (YES)</th>
                    <th scope="col" className="num">Brier</th>
                    <th scope="col" className="num">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e, i) => {
                    const v = tab === 'pool' ? e.crowd! : e.coin!
                    return (
                      <tr key={e.index}>
                        <td>{i + 1}</td>
                        <td>
                          case #{e.index}{' '}
                          <span className={`pill ${v === 'BEAT' ? 'win' : v === 'LOST' ? 'lose' : 'tie'}`}>{v.toLowerCase()}</span>
                        </td>
                        <td className="num">{formatPct(e.p_ppm)}</td>
                        <td className="num mono">{formatBrier(BigInt(e.brier!))}</td>
                        <td className="num mono">{delta(BigInt(e.brier!), BigInt(base!))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
