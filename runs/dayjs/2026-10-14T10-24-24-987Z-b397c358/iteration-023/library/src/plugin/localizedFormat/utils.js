// eslint-disable-next-line import/prefer-default-export
export const t = format =>
  format.replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g, (_, a, b) => a || b.slice(1))

export const englishFormats = {
  LTS: 'h:mm:ss A',
  LT: 'h:mm A',
  L: 'MM/DD/YYYY',
  LL: 'MMMM D, YYYY',
  LLL: 'MMMM D, YYYY h:mm A',
  LLLL: 'dddd, MMMM D, YYYY h:mm A'
}

const formatCache = new Map()
const formatPattern = /(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g

export const u = (formatStr, formats) => {
  const replace = (_, a, b) => {
    const B = b && b.toUpperCase()
    return a || formats[b] || englishFormats[b] || t(formats[B])
  }
  if (typeof formatStr !== 'string') return formatStr.replace(formatPattern, replace)
  let parts = formatCache.get(formatStr)
  if (!parts) {
    parts = formatStr.split(formatPattern)
    if (formatCache.size >= 100) formatCache.clear()
    formatCache.set(formatStr, parts)
  }
  let result = parts[0]
  for (let i = 1; i < parts.length; i += 3) {
    result += replace(undefined, parts[i], parts[i + 1]) + parts[i + 2]
  }
  return result
}
