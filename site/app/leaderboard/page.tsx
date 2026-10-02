import type { Metadata } from 'next'
import { GrokChair } from '@/components/GrokChair'
import { Scoreboard } from '@/components/Scoreboard'
import { DEFAULT_SCENARIO, revealData } from '@/lib/derive'

export const metadata: Metadata = { title: 'Scoreboard' }

export default function LeaderboardPage() {
  const data = revealData()
  return (
    <>
      <div className="kicker">Scoreboard</div>
      <h1>Beat the Coin. Beat the Pool.</h1>
      <p className="lede">
        A forecast only matters if it beats an honest baseline. Lower Brier is better (SPEC §11, integer ppm²). The pool baseline is
        site-defined: floor(YES pool × 10⁶ ÷ total) at close. The spec does not define it yet (OPEN_QUESTIONS #4).
      </p>
      <p className="small muted">Rows are the six conformance cases in <code>forecast.json</code>, ranked. There is no agent field yet.</p>
      <Scoreboard data={data} initial={DEFAULT_SCENARIO} />
      <div style={{ marginTop: '1rem' }}>
        <GrokChair />
      </div>
    </>
  )
}
