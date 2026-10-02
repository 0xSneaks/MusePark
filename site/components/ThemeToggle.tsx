'use client'
import { useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'musepark-theme'

function current(): Theme {
  const set = document.documentElement.dataset.theme
  if (set === 'light' || set === 'dark') return set
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => 'dark' as Theme)
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next
        try {
          localStorage.setItem(KEY, next)
        } catch {
          // storage unavailable: theme still applies for this page view
        }
        listeners.forEach((l) => l())
      }}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

/** Runs before paint so a saved theme doesn't flash. */
export const THEME_BOOT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`
