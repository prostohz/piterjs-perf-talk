import { FORMAT_DEFAULT } from '../../constant'
import { u, englishFormats } from './utils'

export default (o, c, d) => {
  const proto = c.prototype
  const oldFormat = proto.format
  const utils = proto.$utils()
  const oldPad = utils.s
  utils.s = (value, length, pad) => {
    if (pad !== '0' || (length !== 2 && length !== 3 && length !== 4)) {
      return oldPad(value, length, pad)
    }
    const str = String(value)
    return !str || str.length >= length ? value : `${'000'.slice(str.length - length)}${value}`
  }

  d.en.formats = englishFormats
  proto.format = function (formatStr = FORMAT_DEFAULT) {
    const { formats = {} } = this.$locale()
    const result = u(formatStr, formats)
    return oldFormat.call(this, result)
  }
}

