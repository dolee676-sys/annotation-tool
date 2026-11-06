export function parseVersion(value: string): number[] {
  return value
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0)
}

export function parseReleaseVersion(url: string, html = ''): string | null {
  const fromUrl = url.match(/\/tag\/v?([0-9]+\.[0-9]+\.[0-9]+)(?:$|[?#])/)
  if (fromUrl) return fromUrl[1]
  const fromTitle = html.match(/<title>[^<]*?v([0-9]+\.[0-9]+\.[0-9]+)/i)
  if (fromTitle) return fromTitle[1]
  const fromLink = html.match(/\/releases\/tag\/v?([0-9]+\.[0-9]+\.[0-9]+)/)
  return fromLink?.[1] ?? null
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left > right
  }
  return false
}
