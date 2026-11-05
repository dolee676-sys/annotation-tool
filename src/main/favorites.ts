import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FavoriteRecord } from '../shared/types'

const MAX_FAVORITES = 500

export class FavoriteStore {
  private file: string
  private items: FavoriteRecord[] = []

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'favorites.json')
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
        if (Array.isArray(parsed)) this.items = parsed as FavoriteRecord[]
      } catch {
        console.error('[favorites] 读取失败，使用空列表')
      }
    }
    if (this.items.length > MAX_FAVORITES) {
      this.items = this.items.slice(-MAX_FAVORITES)
      this.rewrite()
    }
  }

  newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  add(item: FavoriteRecord): boolean {
    const previous = this.items
    const next = [...this.items, item]
    this.items = next.length > MAX_FAVORITES ? next.slice(-MAX_FAVORITES) : next
    if (this.rewrite()) return true
    this.items = previous
    return false
  }

  list(): FavoriteRecord[] {
    return [...this.items].reverse()
  }

  findByTurnId(turnId: string): FavoriteRecord | undefined {
    return this.items.find((item) => item.turnId === turnId)
  }

  remove(id: string): boolean {
    const previous = this.items
    this.items = this.items.filter((item) => item.id !== id)
    if (this.rewrite()) return true
    this.items = previous
    return false
  }

  clear(): boolean {
    const previous = this.items
    this.items = []
    if (this.rewrite()) return true
    this.items = previous
    return false
  }

  private rewrite(): boolean {
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.items, null, 2), 'utf8')
      renameSync(tmp, this.file)
      return true
    } catch (error) {
      console.error('[favorites] 写入失败，保留内存副本', error)
      return false
    }
  }
}
