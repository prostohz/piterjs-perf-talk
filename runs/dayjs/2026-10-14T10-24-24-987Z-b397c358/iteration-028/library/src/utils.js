import * as C from './constant'

const padStart = (string, length, pad) => {
  const s = String(string)
  if (!s || s.length >= length) return string
  return `${Array((length + 1) - s.length).join(pad)}${string}`
}

const padZoneStr = (instance) => {
  const negMinutes = -instance.utcOffset()
  const minutes = Math.abs(negMinutes)
  const hourOffset = Math.floor(minutes / 60)
  const minuteOffset = minutes % 60
  return `${negMinutes <= 0 ? '+' : '-'}${padStart(hourOffset, 2, '0')}:${padStart(minuteOffset, 2, '0')}`
}

const monthDiff = (a, b) => {
  // function from moment.js in order to keep the same result
  if (a.date() < b.date()) return -monthDiff(b, a)
  const wholeMonthDiff = ((b.year() - a.year()) * 12) + (b.month() - a.month())
  const anchor = a.clone().$set(C.M, a.month() + wholeMonthDiff)
  const c = b - anchor < 0
  const anchor2 = a.clone().$set(C.M, a.month() + wholeMonthDiff + (c ? -1 : 1))
  return +(-(wholeMonthDiff + ((b - anchor) / (c ? (anchor - anchor2) :
    (anchor2 - anchor)))) || 0)
}

const absFloor = n => (n < 0 ? Math.ceil(n) || 0 : Math.floor(n))

const specialUnits = {
  M: C.M,
  y: C.Y,
  w: C.W,
  d: C.D,
  D: C.DATE,
  h: C.H,
  m: C.MIN,
  s: C.S,
  ms: C.MS,
  Q: C.Q,
  year: C.Y,
  years: C.Y,
  month: C.M,
  months: C.M,
  week: C.W,
  weeks: C.W,
  day: C.D,
  days: C.D,
  date: C.DATE,
  dates: C.DATE,
  hour: C.H,
  hours: C.H,
  minute: C.MIN,
  minutes: C.MIN,
  second: C.S,
  seconds: C.S,
  millisecond: C.MS,
  milliseconds: C.MS,
  quarter: C.Q,
  quarters: C.Q
}

const prettyUnit = u => specialUnits[u] || String(u || '').toLowerCase().replace(/s$/, '')

const isUndefined = s => s === undefined

export default {
  s: padStart,
  z: padZoneStr,
  m: monthDiff,
  a: absFloor,
  p: prettyUnit,
  u: isUndefined
}
