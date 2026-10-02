import type { Metadata } from 'next'
import { checkParimutuel } from '@/lib/derive'
import { units } from '@/lib/format'
import { loadArbitration } from '@/lib/vectors'

export const metadata: Metadata = { title: 'Fees' }

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`

export default function FeesPage() {
  const { instance } = loadArbitration()
  const ex = checkParimutuel().find((c) => c.name === 'normal_with_dust')!
  const split = instance.fee_split_bps
  return (
    <>
      <div className="kicker">Ticket Booth</div>
      <h1>Every fee, in the open.</h1>
      <p className="lede">
        Season 0 moves no money. This page shows how fees work in the protocol (SPEC §9, §10.5, §12), using the example instance in{' '}
        <code>arbitration.json</code>. Fees are set per market instance; these numbers are that example&apos;s.
      </p>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.15rem' }}>All fees</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Fee</th><th scope="col">When</th><th scope="col">Goes to</th><th scope="col" className="num">Example</th></tr></thead>
            <tbody>
              <tr><td>Creation fee</td><td>PROPOSE</td><td>Treasury, non-refundable</td><td className="num mono">{units(instance.creation_fee)}</td></tr>
              <tr><td>Trading fee</td><td>SETTLE, YES/NO outcome with winners and losers</td><td>Fee split (below)</td><td className="num">{pct(instance.fee_bps)} of the losing pool</td></tr>
              <tr><td>Slashed bonds</td><td>SETTLE</td><td>50% to correct claimants (by bond), 50% plus rounding dust to treasury</td><td className="num">—</td></tr>
              <tr><td>Payout dust</td><td>SETTLE</td><td>Treasury</td><td className="num">—</td></tr>
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          No fee is charged when the market is INVALID, one-sided, or nobody picked the winner: every stake is refunded. Winners never lose
          money, because the fee comes only from the losing pool.
        </p>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.15rem' }}>The fee split</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Recipient</th><th scope="col" className="num">Split</th><th scope="col">Who that is</th></tr></thead>
            <tbody>
              <tr><td>Proposer</td><td className="num">{pct(split.proposer)}</td><td>Whoever published PROPOSE</td></tr>
              <tr><td>Resolver</td><td className="num">{pct(split.resolver)}</td><td>Earliest accepted claim matching the final outcome</td></tr>
              <tr><td>Settler</td><td className="num">{pct(split.settler)}</td><td>Whoever submitted SETTLE</td></tr>
              <tr><td><strong>Treasury</strong></td><td className="num"><strong>{pct(split.treasury)}</strong></td><td>Plus all rounding remainders and payout dust</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.15rem' }}>Worked example: <code>normal_with_dust</code></h2>
        <p className="small muted">From <code>parimutuel.json</code>, recomputed with SPEC §9 integer math at build time.</p>
        <dl className="kv">
          <dt>trading fee</dt><dd className="mono">{units(ex.result.fee_total)}</dd>
          <dt>proposer</dt><dd className="mono">{units(ex.result.fee_shares.proposer)}</dd>
          <dt>resolver</dt><dd className="mono">{units(ex.result.fee_shares.resolver)}</dd>
          <dt>settler</dt><dd className="mono">{units(ex.result.fee_shares.settler)}</dd>
          <dt>payout dust</dt><dd className="mono">{units(ex.result.dust)}</dd>
          <dt>treasury total</dt><dd className="mono">{units(ex.result.treasury_total)}</dd>
        </dl>
      </section>

      <p className="note">
        Slashed bonds go to the <strong>treasury</strong>, per SPEC §10.5 and §12. The README currently says that half is &quot;sunk&quot;; that
        wording disagrees with the spec and is logged as{' '}
        <a href="https://github.com/0xSneaks/MusePark/issues/14">SPEC-BUG #14</a>.
      </p>
    </>
  )
}
