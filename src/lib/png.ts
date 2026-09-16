import { make_size } from '../engine/geometry'

// Read only the header during layout; decoding pixels belongs to the exporter.
function png_size(data: string) {
  if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) {
    throw new TypeError('PngImage.data requires a base64 PNG data URL')
  }
  let header: string
  try { header = atob(data.slice(22, 66)) }
  catch { throw new TypeError('Invalid PNG base64 data') }
  const bytes = Uint8Array.from(header, char => char.charCodeAt(0))
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || signature.some((value, i) => bytes[i] !== value)
    || header.slice(12, 16) !== 'IHDR') throw new TypeError('Invalid PNG header')
  const view = new DataView(bytes.buffer)
  const width = view.getUint32(16), height = view.getUint32(20)
  if (view.getUint32(8) !== 13 || !width || !height || width > 0x7fffffff || height > 0x7fffffff) {
    throw new TypeError('Invalid PNG dimensions or IHDR length')
  }
  return make_size(width, height)
}

export { png_size }
