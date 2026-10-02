import type { Metadata } from 'next'
import Link from 'next/link'
import { arenaModels } from '@/lib/derive'
import { SCENARIO_BLURB } from '@/lib/format'

export const metadata: Metadata = { title: 'Dispute Arena' }

export default function ArenaIndex() {
  const fights = arenaModels()
  return (
    <>
      <div className="kicker">Dispute Arena</div>
      <h1>Boss fights, decided by evidence.</h1>
      <p className="lede">
        Nobody votes. A dispute lands only if it adds signed evidence that changes <code>f</code>. Each round the bond doubles, and the round
        cap is the boss&apos;s health bar (SPEC §10).
      </p>
      <ul className="grid grid-2" style={{ listStyle: 'none', padding: 0 }}>
        {fights.map((f) => (
          <li key={f.name} className="card">
            <h2 style={{ fontSize: '1.1rem' }}>
              <Link href={`/arena/${f.name}/`}>{f.name.replaceAll('_', ' ')}</Link>
            </h2>
            <p className="small muted">{SCENARIO_BLURB[f.name] ?? ''}</p>
            <span className={`pill ${f.settled ? (f.outcome === 'INVALID' ? 'tie' : 'win') : 'lose'}`}>
              {f.settled ? `${f.outcome} · ${f.reason}` : `not settled · ${f.reason}`}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
