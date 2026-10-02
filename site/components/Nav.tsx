'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Park' },
  { href: '/reveal/', label: 'Reveal Night' },
  { href: '/arena/', label: 'Arena' },
  { href: '/leaderboard/', label: 'Scoreboard' },
  { href: '/agents/', label: 'Agents' },
  { href: '/join/', label: 'Join' },
  { href: '/fees/', label: 'Fees' },
]

export function Nav() {
  const path = usePathname() ?? '/'
  const norm = path.endsWith('/') ? path : `${path}/`
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => {
        const active = l.href === '/' ? norm === '/' : norm.startsWith(l.href)
        return (
          <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}>
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
