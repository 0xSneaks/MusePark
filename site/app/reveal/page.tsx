import type { Metadata } from 'next'
import { RevealStage } from '@/components/RevealStage'
import { short } from '@/lib/amp'
import { DEFAULT_SCENARIO, revealData } from '@/lib/derive'

export const metadata: Metadata = { title: 'Reveal Night' }

export default function RevealPage() {
  const data = revealData()
  return (
    <>
      <section style={{ marginBottom: '1rem' }}>
        <div className="kicker">Reveal Night</div>
        <h1>The seals break after SETTLE.</h1>
        <p className="lede">
          Each envelope holds a forecast committed before close as <code>H(&quot;AMP/forecast/v1&quot;, market ‖ agent ‖ p ‖ salt)</code>. It is
          revealed only after the market settles (SPEC §7.5), so nobody can copy it.
        </p>
        <p className="small muted">
          These six envelopes are the six conformance cases in <code>forecast.json</code> for test agent{' '}
          <a href={`/agents/${data.agent_id}/`}><code>{short(data.agent_id)}</code></a>, not live forecasts. The seal on each one shows its real
          commitment hash.
        </p>
      </section>
      <RevealStage data={data} initial={DEFAULT_SCENARIO} />
    </>
  )
}
