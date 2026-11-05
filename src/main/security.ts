import { pathToFileURL } from 'node:url'

export function rendererFileUrl(indexPath: string): string {
  return pathToFileURL(indexPath).toString()
}

export function isTrustedRendererUrl(
  url: string,
  appFileUrl: string,
  devUrl?: string
): boolean {
  if (!url) return false
  const clean = url.split('#')[0].split('?')[0]
  if (devUrl) {
    const base = devUrl.replace(/\/+$/, '')
    return clean === base || clean.startsWith(`${base}/`)
  }
  return clean === appFileUrl
}
