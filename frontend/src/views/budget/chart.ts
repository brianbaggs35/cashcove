import { addDays } from '@/utils/dates'
import { toCents } from '@/utils/money'

/** An axis from zero to a round number, with round steps between. */
export interface Ticks {
  ticks: number[]
  max: number
}

/** The round steps an axis can climb in, as a share of its power of ten; the next is 10. */
const STEPS = [1, 2, 2.5, 5]

/**
 * The ticks for an axis from 0 to a little over `maximum`: about `target` of them, each a round
 * number like 500 or 2,500, the last of which is the top of the axis.
 */
export function niceTicks(maximum: number, target = 4): Ticks {
  if (maximum <= 0 || Number.isNaN(maximum)) return { ticks: [0, 1], max: 1 }
  const raw = maximum / target
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / magnitude
  // The smallest of 1, 2, 2.5, 5 and 10 that makes the steps no smaller than `raw`.
  const step = magnitude * (STEPS.find((candidate) => fraction <= candidate) ?? 10)
  const count = Math.ceil(maximum / step - 1e-9)
  return { ticks: Array.from({ length: count + 1 }, (_, index) => index * step), max: count * step }
}

/** An amount short enough for an axis: $2K, $1.5M. */
export function compactMoney(value: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

/** Which of `count` evenly spaced points is nearest a position along the chart, from 0 to 1. */
export function nearestIndex(position: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.round(position * (count - 1))))
}

/**
 * How much has been spent by the end of each day from the first, up to `through` days in, in
 * dollars. Days with nothing spent carry the total before them.
 */
export function runningTotal(
  daily: { day: string; spent: string }[],
  start: string,
  through: number,
): number[] {
  const spent = new Map(daily.map((item) => [item.day, toCents(item.spent)]))
  const totals: number[] = []
  let cents = 0
  for (let index = 0; index <= through; index++) {
    cents += spent.get(addDays(start, index)) ?? 0
    totals.push(cents / 100)
  }
  return totals
}

/** The points of a line as an SVG path: one for each, joined by straight lines. */
export function linePath(points: readonly (readonly [number, number])[]): string {
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ')
}

/** A column from `top` down to `bottom`: rounded where it ends, square on the baseline. Nothing if it has no height. */
export function columnPath(
  x: number,
  top: number,
  width: number,
  bottom: number,
  radius = 4,
): string {
  const height = bottom - top
  if (height <= 0 || Number.isNaN(height)) return ''
  const round = Math.min(radius, width / 2, height)
  const [left, right] = [x, x + width].map((value) => value.toFixed(1))
  const [edge, arc] = [top, top + round].map((value) => value.toFixed(1))
  const [start, end] = [x + round, x + width - round].map((value) => value.toFixed(1))
  return `M${left} ${bottom.toFixed(1)}V${arc}Q${left} ${edge} ${start} ${edge}H${end}Q${right} ${edge} ${right} ${arc}V${bottom.toFixed(1)}Z`
}

/**
 * How far a tooltip centred on `position` moves sideways, as a CSS `translateX`, to stay on a
 * chart `width` wide: held to the left or the right edge near either, centred otherwise.
 */
export function tipShift(position: number, width: number): string {
  if (position < width * 0.2) return '0'
  if (position > width * 0.8) return '-100%'
  return '-50%'
}
