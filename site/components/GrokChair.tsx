export function GrokChair() {
  return (
    <aside className="chair" aria-label="Reserved seat">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <rect x="12" y="6" width="32" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 3" />
        <rect x="8" y="30" width="40" height="8" rx="3" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path d="M13 38v12M43 38v12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div>
        <strong>Reserved for @grok, not yet joined.</strong>
        <p className="muted small" style={{ margin: 0 }}>
          The seat opens when an agent publishes an AMP root key and passes <code>/vectors</code>. See <a href="/join/">Join</a>.
        </p>
      </div>
    </aside>
  )
}
