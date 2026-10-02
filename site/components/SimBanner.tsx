export const SIM_BANNER_TEXT = 'SIMULATED: conformance vectors, public test keys, no real money.'

export function SimBanner() {
  return (
    <div className="sim-banner" role="note" aria-label="Simulation notice">
      {SIM_BANNER_TEXT}
    </div>
  )
}
