import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { short } from '@/lib/amp'
import { arenaModels } from '@/lib/derive'
import { SCENARIO_BLURB, units, utc } from '@/lib/format'

export const dynamicParams = false

export function generateStaticParams() {
  return arenaModels().map((f) => ({ id: f.name }))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  return { title: `Arena: ${id.replaceAll('_', ' ')}` }
}

export default async function Fight({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const f = arenaModels().find((x) => x.name === id)
  if (!f) notFound()
  const hpLeft = f.max_rounds - f.rounds_used
  const maxBond = f.steps.reduce((m, s) => (BigInt(s.bond) > m ? BigInt(s.bond) : m), BigInt(f.base_bond))
  const claimIndex = new Map<number, number>()
  f.steps.forEach((s, i) => {
    if (s.accepted) claimIndex.set(i, claimIndex.size)
  })

  return (
    <>
      <p className="small"><Link href="/arena/">← All fights</Link></p>
      <div className="kicker">Dispute Arena · arbitration.json</div>
      <h1>{f.name.replaceAll('_', ' ')}</h1>
      <p className="lede">{SCENARIO_BLURB[f.name]}</p>

      <section className="card" style={{ marginBottom: '1rem' }} aria-label="Round cap">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '1.1rem' }}>Boss HP: round cap</h2>
          <span className="mono small">{hpLeft} / {f.max_rounds}</span>
        </div>
        <div className="hp" role="img" aria-label={`${hpLeft} of ${f.max_rounds} dispute rounds left`}>
          {Array.from({ length: f.max_rounds }, (_, i) => (
            <span key={i} className={i < f.rounds_used ? 'lost' : ''} />
          ))}
        </div>
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          If the {f.max_rounds}th dispute lands, the game ends INVALID (ROUND_CAP) and every bond is refunded. Base bond B ={' '}
          {units(f.base_bond)}; the k-th dispute must post at least B × 2<sup>k</sup>.
        </p>
        <p className="small" style={{ margin: 0 }}>Question: {f.question}</p>
      </section>

      <ol className="timeline">
        {f.steps.map((s, i) => {
          const ci = claimIndex.get(i)
          const ret = ci !== undefined && f.bond_returns ? f.bond_returns[ci] : null
          return (
            <li key={i} className={`card hit${s.accepted ? '' : ' rejected'}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <strong>
                  {s.kind === 'DISPUTE' ? `Dispute${s.round ? ` · round ${s.round}` : ''}` : 'Resolve'} → {s.claimed}
                </strong>
                <span className={`pill ${s.accepted ? 'win' : 'tie'}`}>{s.accepted ? 'landed' : `bounced: ${s.why}`}</span>
              </div>
              <div className="bondbar" style={{ width: `${Number((BigInt(s.bond) * 100n) / maxBond)}%`, marginTop: '0.5rem' }} aria-hidden="true" />
              <dl className="kv small" style={{ marginTop: '0.5rem' }}>
                <dt>bond posted</dt><dd className="mono">{units(s.bond)} (min {units(s.min_bond)})</dd>
                <dt>evidence</dt><dd>{s.evidence_count} signed observation{s.evidence_count === 1 ? '' : 's'}</dd>
                <dt>claimant</dt><dd className="mono">{short(s.claimant)}</dd>
                <dt>anchored</dt><dd className="mono">{utc(s.ts)}</dd>
                {ret !== null && (<><dt>bond back</dt><dd className="mono">{units(ret)}{ret === '0' ? ' (slashed)' : ''}</dd></>)}
                {!s.accepted && (<><dt>bond back</dt><dd>never taken: the transaction reverts (SPEC §10.3)</dd></>)}
              </dl>
            </li>
          )
        })}
        {f.steps.length === 0 && <li className="card">No claim was made before the resolve window closed.</li>}
      </ol>

      <section className="card" style={{ marginTop: '1rem' }} aria-label="Final">
        <h2 style={{ fontSize: '1.1rem' }}>Final</h2>
        {f.settled ? (
          <dl className="kv">
            <dt>outcome</dt><dd><strong>{f.outcome}</strong> ({f.reason})</dd>
            <dt>settled at</dt><dd className="mono">{utc(f.settle_ts)}</dd>
            <dt>slashed bonds to treasury</dt><dd className="mono">{units(f.treasury_from_slash ?? '0')}</dd>
          </dl>
        ) : (
          <p style={{ margin: 0 }}>
            SETTLE at <span className="mono">{utc(f.settle_ts)}</span> was rejected: <strong>{f.reason}</strong>. The dispute window had not closed.
          </p>
        )}
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          Bond figures are recomputed with SPEC §10.5 integer math and checked against the vector at build time.
        </p>
      </section>
    </>
  )
}
