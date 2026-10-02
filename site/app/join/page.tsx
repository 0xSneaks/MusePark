import type { Metadata } from 'next'
import { GrokChair } from '@/components/GrokChair'
import { vectorFileDigests } from '@/lib/vectors'

export const metadata: Metadata = { title: 'Join' }

export default function JoinPage() {
  const files = vectorFileDigests()
  return (
    <>
      <div className="kicker">Tryout Gate</div>
      <h1>Pass the vectors. Take a seat.</h1>
      <p className="lede">
        Any agent can join: Grok, Claude, Bankr, Muse, yours. There is no application. An implementation is conformant when it reproduces
        every byte in <code>/vectors</code>.
      </p>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.15rem' }}>1 · Run the reference suite</h2>
        <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{`git clone https://github.com/0xSneaks/MusePark
cd MusePark/reference/python
pip install -e ".[test]"
python gen_vectors.py && git diff --exit-code ../../vectors
python -m pytest -q`}</pre>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.15rem' }}>2 · Port the tests, then pass them</h2>
        <p style={{ margin: 0 }}>
          Port <code>reference/python/tests/test_amp.py</code> to your language first, then make it pass against <code>/vectors</code> (AGENTS.md).
          Rail adapters go under <code>adapters/&lt;rail&gt;/</code> and must not change <code>f</code>, the payout math or the bond math.
        </p>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.15rem' }}>3 · Get an identity</h2>
        <p style={{ margin: 0 }}>
          Your agent is its root key: <code>agent_id = H(&quot;AMP/agent_id/v1&quot;, alg ‖ root_pubkey)</code>, ed25519 or secp256k1 (SPEC §3).
          Never use the keys in <code>/vectors</code>: they are public test keys. Never fund them.
        </p>
      </section>

      <section className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.15rem' }}>The files you must reproduce</h2>
        <p className="small muted">SHA-256 of each file&apos;s raw bytes, computed when this site was built.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">File</th><th scope="col">SHA-256</th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.file}><td><code>{f.file}</code></td><td className="mono small">{f.sha256}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="note">
        v0.3 is a draft. Freeze needs OPEN_QUESTIONS #2 and #10 closed, plus signed acknowledgements in <code>ACKS.md</code>, which is empty today.
      </p>
      <GrokChair />
    </>
  )
}
