// Report periods as inclusive YYYY-MM-DD ranges in the company's timezone.

export const PERIODS = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-quarter': 'This quarter',
  'this-fy': 'This financial year',
  'this-year': 'This calendar year',
  all: 'All time',
} as const
export type PeriodKey = keyof typeof PERIODS | 'custom'

export type Range = { from: string | null; to: string | null; label: string }

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

// The calendar date of an instant in the company's timezone (en-CA formats as YYYY-MM-DD).
export function dateIn(timezone: string, at: Date | string = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(typeof at === 'string' ? new Date(at) : at)
}

export const todayIn = (timezone: string) => dateIn(timezone)

export function resolvePeriod(key: string | undefined, from: string | undefined, to: string | undefined, timezone: string): Range & { key: PeriodKey } {
  const [y, m] = todayIn(timezone).split('-').map(Number)
  const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

  switch (key) {
    case 'custom':
      if (isDate(from) || isDate(to)) {
        return { key: 'custom', from: isDate(from) ? from! : null, to: isDate(to) ? to! : null, label: 'Custom range' }
      }
      break
    case 'last-month': {
      const ly = m === 1 ? y - 1 : y
      const lm = m === 1 ? 12 : m - 1
      return { key, from: iso(ly, lm, 1), to: iso(ly, lm, lastDay(ly, lm)), label: PERIODS[key] }
    }
    case 'this-quarter': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1
      return { key, from: iso(y, qm, 1), to: iso(y, qm + 2, lastDay(y, qm + 2)), label: PERIODS[key] }
    }
    case 'this-fy': {
      // Indian financial year: 1 April to 31 March.
      const fy = m >= 4 ? y : y - 1
      return { key, from: iso(fy, 4, 1), to: iso(fy + 1, 3, 31), label: PERIODS[key] }
    }
    case 'this-year':
      return { key, from: iso(y, 1, 1), to: iso(y, 12, 31), label: PERIODS[key] }
    case 'all':
      return { key, from: null, to: null, label: PERIODS[key] }
  }
  return { key: 'this-month', from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)), label: PERIODS['this-month'] }
}

export function inRange(date: string | null | undefined, r: Range) {
  if (!date) return false
  const d = date.slice(0, 10)
  return (!r.from || d >= r.from) && (!r.to || d <= r.to)
}
