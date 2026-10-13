// 生成应用图标（PNG），输出到 apps/web/public/。不依赖任何图片库：直接按几何形状算像素，4×4 超采样抗锯齿。
//   node scripts/make-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const OUT = path.resolve(import.meta.dirname, '../apps/web/public')
const BLUE = [0x2e, 0x4f, 0xd6]
const YELLOW = [0xff, 0xe8, 0x73]

// 以 0~1 的坐标描述图标：蓝色满底 + 三条黄色圆头横线（和网页小图标一致）
const LINES = [
  { x1: 0.3, x2: 0.7, y: 0.36 },
  { x1: 0.3, x2: 0.7, y: 0.5 },
  { x1: 0.3, x2: 0.56, y: 0.64 },
]
const R = 0.045

function colorAt(x, y) {
  for (const l of LINES) {
    const cx = Math.min(Math.max(x, l.x1), l.x2)
    if (Math.hypot(x - cx, y - l.y) <= R) return YELLOW
  }
  return BLUE
}

function render(size) {
  const S = 4
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0 // 每行开头的滤波类型：无
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const c = colorAt((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size)
          r += c[0]; g += c[1]; b += c[2]
        }
      const o = py * (size * 4 + 1) + 1 + px * 4
      raw[o] = Math.round(r / S / S)
      raw[o + 1] = Math.round(g / S / S)
      raw[o + 2] = Math.round(b / S / S)
      raw[o + 3] = 255
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync(OUT, { recursive: true })
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(OUT, name), render(size))
  console.log(`${name} ${size}×${size}`)
}
