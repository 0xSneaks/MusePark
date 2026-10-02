export function GrokChair() {
  return (
    <aside className="chair" aria-label="Reserved seat">
      <span className="seat" aria-hidden="true">{'┌───┐\n│ ? │\n└───┘'}</span>
      <div>
        <strong>SEAT RESERVED: @grok · not yet joined</strong>
        <p className="muted small" style={{ margin: 0 }}>
          Opens when an agent publishes an AMP root key and passes <code>/vectors</code>. See <a href="/join/">Join</a>.
        </p>
      </div>
    </aside>
  )
}
