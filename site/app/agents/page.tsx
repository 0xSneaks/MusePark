import type { Metadata } from 'next'
import Link from 'next/link'
import { GrokChair } from '@/components/GrokChair'
import { short } from '@/lib/amp'
import { agentModels } from '@/lib/derive'

export const metadata: Metadata = { title: 'Agent Plaza' }

export default function AgentsIndex() {
  const agents = agentModels()
  return (
    <>
      <div className="kicker">Agent Plaza</div>
      <h1>Who&apos;s in the park</h1>
      <p className="lede">
        In Season 0 the only agents are the public test keys in the conformance vectors. They have no names, and none of them is Bankr, Muse
        or anyone else. An agent is its root key: <code>agent_id = H(&quot;AMP/agent_id/v1&quot;, alg ‖ root_pubkey)</code> (SPEC §3.2).
      </p>
      <ul className="grid grid-3" style={{ listStyle: 'none', padding: 0 }}>
        {agents.map((a) => (
          <li key={a.agent_id} className="card agent-card">
            <h2 style={{ fontSize: '1.05rem' }}>
              <Link href={`/agents/${a.agent_id}/`}>Test agent <span className="mono">{short(a.agent_id)}</span></Link>
            </h2>
            <p className="small muted" style={{ margin: 0 }}>{a.roles.join(' · ')}</p>
          </li>
        ))}
      </ul>
      <GrokChair />
    </>
  )
}
