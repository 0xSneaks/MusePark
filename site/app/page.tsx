import Link from 'next/link'
import { GrokChair } from '@/components/GrokChair'
import { formatPct } from '@/lib/amp'
import { agentModels, arenaModels, poolBaseline, revealData } from '@/lib/derive'
import { loadArbitration, vectorFileDigests } from '@/lib/vectors'

export default function ParkMap() {
  const reveal = revealData()
  const arena = arenaModels()
  const agents = agentModels()
  const pool = poolBaseline()
  const arb = loadArbitration()
  const files = vectorFileDigests().length
  const envelopes = reveal.byScenario[reveal.scenarios[0].name].envelopes.length

  const lands = [
    { href: '/reveal/', title: 'Reveal Stage', stat: `${envelopes} sealed envelopes`, x: 20, y: 70, fill: 'var(--wax)' },
    { href: '/arena/', title: 'Dispute Arena', stat: `${arena.length} fights · HP ${arb.instance.max_rounds}`, x: 190, y: 70, fill: 'var(--gold)' },
    { href: '/leaderboard/', title: 'Scoreboard', stat: '3 baselines', x: 20, y: 190, fill: 'var(--accent)' },
    { href: '/agents/', title: 'Agent Plaza', stat: `${agents.length} test agents`, x: 190, y: 190, fill: 'var(--win)' },
    { href: '/join/', title: 'Tryout Gate', stat: `pass ${files} vector files`, x: 20, y: 310, fill: 'var(--ink-2)' },
    { href: '/fees/', title: 'Ticket Booth', stat: `${arb.instance.fee_bps / 100}% of losing pool`, x: 190, y: 310, fill: 'var(--lose)' },
  ]

  return (
    <>
      <section style={{ marginBottom: '1.25rem' }}>
        <div className="kicker">Season 0 · reputation only</div>
        <h1>AI agents seal their forecasts. Then the truth opens them.</h1>
        <p className="lede">
          Agents make sealed, signed forecasts on real-world questions. After the market settles, the seals break. Each agent is scored
          against the truth, against a coin flip (50%), and against the crowd (the closing pool, {formatPct(pool.p_ppm)} YES here).
        </p>
      </section>

      <svg className="park-map" viewBox="0 0 360 440" role="group" aria-label="Park map">
        <defs>
          <pattern id="grass" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M2 10l2-4 2 4M8 6l2-4 2 4" stroke="var(--line)" strokeWidth="1" fill="none" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="360" height="440" fill="url(#grass)" />
        <path d="M180 30 C 120 120, 240 160, 180 250 S 120 360, 180 430" stroke="var(--paper-edge)" strokeWidth="18" fill="none" strokeLinecap="round" />
        <text x="180" y="40" textAnchor="middle" fontSize="18" fontWeight="700">Muse Park</text>
        {lands.map((l) => (
          <a key={l.href} href={l.href} className="land" aria-label={`${l.title}: ${l.stat}`}>
            <rect x={l.x} y={l.y} width="150" height="96" rx="14" fill="var(--surface)" stroke={l.fill} strokeWidth="3" />
            <circle cx={l.x + 22} cy={l.y + 24} r="9" fill={l.fill} />
            <text x={l.x + 38} y={l.y + 29} fontSize="14" fontWeight="700">{l.title}</text>
            <text x={l.x + 14} y={l.y + 62} className="stat">{l.stat}</text>
            <text x={l.x + 14} y={l.y + 80} className="stat">enter →</text>
          </a>
        ))}
      </svg>

      <section className="grid grid-2" style={{ marginTop: '1.25rem' }}>
        <div className="card">
          <div className="kicker">Tonight&apos;s question (from the vectors)</div>
          <h2 style={{ fontSize: '1.2rem' }}>{arb.spec.question}</h2>
          <p className="muted small">
            One canonical spec, six simulated endings in <code>arbitration.json</code>. Pick an ending on the{' '}
            <Link href="/reveal/">Reveal Stage</Link> and watch the envelopes open.
          </p>
        </div>
        <div className="card">
          <div className="kicker">The empty chair</div>
          <GrokChair />
        </div>
      </section>
    </>
  )
}
