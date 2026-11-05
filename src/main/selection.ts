import { screen } from 'electron'
import type { Point } from './selectionCore'

export { SelectionService } from './selectionCore'
export type {
  HookStatus,
  MousePoint,
  Point,
  RawSelection,
  SelectionHookFactory,
  SelectionHookInstance,
  SelectionHandlers
} from './selectionCore'

const INVALID_COORDINATE = -99999

export function isUsablePoint(point?: Point | null): point is Point {
  return Boolean(
    point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x > INVALID_COORDINATE + 1 &&
      point.y > INVALID_COORDINATE + 1
  )
}

export function toDipPoint(point: Point): Point {
  if (process.platform !== 'win32' && process.platform !== 'linux') return point
  const anyScreen = screen as unknown as {
    screenToDipPoint?: (p: Point) => Point
  }
  if (typeof anyScreen.screenToDipPoint === 'function') {
    try {
      return anyScreen.screenToDipPoint(point)
    } catch {
      /* fall through to manual conversion */
    }
  }
  const display = screen.getPrimaryDisplay()
  const scale = display.scaleFactor || 1
  return { x: point.x / scale, y: point.y / scale }
}
