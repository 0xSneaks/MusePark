import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIM_BANNER_TEXT } from '@/components/SimBanner'

// Copy rules: no token, no "earn", no yield, no fee-share language anywhere.
const BANNED = [/\btokens?\b/i, /\bearn(s|ed|ing|ings)?\b/i, /\byield/i, /fee[\s-]+share/i]

function walk(dir: string, ext: string[]): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    if (statSync(p).isDirectory()) return walk(p, ext)
    return ext.some((e) => p.endsWith(e)) ? [p] : []
  })
}

function hits(text: string): string[] {
  return BANNED.flatMap((re) => {
    const m = text.match(new RegExp(re.source, re.flags + 'g'))
    return m ?? []
  })
}

describe('copy rules', () => {
  it('banner text is exact', () => {
    expect(SIM_BANNER_TEXT).toBe('SIMULATED: conformance vectors, public test keys, no real money.')
  })

  it.each(walk(path.resolve('app'), ['.tsx']).concat(walk(path.resolve('components'), ['.tsx'])))('source %s has no banned words', (file) => {
    expect(hits(readFileSync(file, 'utf8'))).toEqual([])
  })

  const out = path.resolve('out')
  const pages = existsSync(out) ? walk(out, ['.html']) : []
  it.runIf(pages.length > 0).each(pages)('built page %s: banner present, no banned words', (file) => {
    const html = readFileSync(file, 'utf8')
    const visible = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
    expect(visible).toContain(SIM_BANNER_TEXT)
    expect(hits(visible)).toEqual([])
  })
})
