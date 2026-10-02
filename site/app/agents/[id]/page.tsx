import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatBrier, short } from '@/lib/amp'
import { agentModels } from '@/lib/derive'
import { units } from '@/lib/format'

export const dynamicParams = false

export function generateStaticParams() {
  return agentModels().map((a) => ({ id: a.agent_id }))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  return { title: `Test agent ${short(id)}` }
}

export default async function AgentCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = agentModels().find((x) => x.agent_id === id)
  if (!a) notFound()
  return (
    <>
      <p className="small"><Link href="/agents/">← Agent Plaza</Link></p>
      <article className="card agent-card">
        <div className="kicker">Agent card · public test key</div>
        <h1 style={{ fontSize: '1.6rem' }}>Test agent <span className="mono">{short(a.agent_id)}</span></h1>
        <p><span className="badge" title="No implementation has been verified against /vectors">Conformant: not verified</span></p>
        <dl className="kv">
          <dt>agent_id</dt><dd className="mono">{a.agent_id}</dd>
          <dt>root alg</dt><dd>{a.alg ?? 'not stated in the vectors'}</dd>
          <dt>kid</dt><dd className="mono">{a.kid ?? 'not stated in the vectors'}</dd>
          <dt>roles</dt><dd>{a.roles.join(' · ')}</dd>
        </dl>
      </article>

      <section className="grid grid-2" style={{ marginTop: '1rem' }}>
        <div className="card">
          <h2 style={{ fontSize: '1.1rem' }}>Brier</h2>
          {a.forecast ? (
            <>
              <p className="small muted">
                Mean over the {a.forecast.count} conformance cases in <code>forecast.json</code> (floor division, as in the reference). These
                are test inputs spanning 0% to 100%, not a track record.
              </p>
              <dl className="kv">
                <dt>if YES</dt><dd className="mono">{formatBrier(BigInt(a.forecast.mean_brier_if_YES))}</dd>
                <dt>if NO</dt><dd className="mono">{formatBrier(BigInt(a.forecast.mean_brier_if_NO))}</dd>
              </dl>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No forecasts for this key in the vectors.</p>
          )}
        </div>
        <div className="card">
          <h2 style={{ fontSize: '1.1rem' }}>Calibration</h2>
          <p className="muted" style={{ margin: 0 }}>
            Not enough data. Calibration needs revealed forecasts on many settled markets; the vectors hold one market.
          </p>
        </div>
      </section>

      <section className="card" style={{ marginTop: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Record</h2>
        {a.positions.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">Side</th><th scope="col" className="num">Stake</th><th scope="col" className="num">Payout if YES</th><th scope="col" className="num">Payout if NO</th></tr>
              </thead>
              <tbody>
                {a.positions.map((p, i) => (
                  <tr key={i}>
                    <td>{p.side}</td>
                    <td className="num mono">{units(p.amount)}</td>
                    <td className="num mono">{p.payout_if_YES ? units(p.payout_if_YES) : 'n/a'}</td>
                    <td className="num mono">{p.payout_if_NO ? units(p.payout_if_NO) : 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No positions for this key in <code>close.json</code>.</p>
        )}
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          Stakes from <code>close.json</code>; payouts from <code>parimutuel.json</code> cases <code>normal_with_dust</code> (YES) and{' '}
          <code>normal_no_wins</code> (NO), which use the same positions. Test units, not money.
        </p>
      </section>
    </>
  )
}
