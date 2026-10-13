import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { paths } from './config.ts'

/**
 * 每日备份（由 systemd 定时器调用 `server.mjs backup`）：
 * - 数据库：VACUUM INTO 生成一份完整、一致的副本（服务运行中也可以做）
 * - 文件目录：文件按内容存储、从不修改，所以用硬链接"复制"，几乎不占额外空间
 * - 只保留最近 keep 份；顺便清理 30 天前删除的文件和 7 天前没传完的上传
 */

const DAY = 24 * 60 * 60 * 1000

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else if (e.isFile()) yield full
  }
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function removeOlderThan(dir: string, ms: number): Promise<number> {
  let count = 0
  for await (const file of walk(dir)) {
    const st = await fsp.stat(file)
    if (Date.now() - st.mtimeMs > ms) {
      await fsp.rm(file, { force: true })
      count++
    }
  }
  return count
}

export async function runBackup(dest: string, keep: number) {
  const target = path.join(dest, stamp())
  await fsp.mkdir(target, { recursive: true })

  const db = new DatabaseSync(paths.db())
  db.exec('PRAGMA busy_timeout = 10000')
  db.prepare('VACUUM INTO ?').run(path.join(target, 'note.db'))
  db.close()

  let files = 0
  let bytes = 0
  const assetsDir = paths.assets()
  for await (const file of walk(assetsDir)) {
    const out = path.join(target, 'assets', path.relative(assetsDir, file))
    await fsp.mkdir(path.dirname(out), { recursive: true })
    try {
      await fsp.link(file, out)
    } catch {
      await fsp.copyFile(file, out)
    }
    files++
    bytes += (await fsp.stat(file)).size
  }

  // 只保留最近 keep 份
  const all = (await fsp.readdir(dest)).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(n)).sort()
  const old = all.slice(0, Math.max(0, all.length - keep))
  for (const name of old) await fsp.rm(path.join(dest, name), { recursive: true, force: true })

  const trashed = await removeOlderThan(paths.assetTrash(), 30 * DAY)
  const stale = await removeOlderThan(paths.uploads(), 7 * DAY)

  const dbSize = (await fsp.stat(path.join(target, 'note.db'))).size
  console.log(
    `备份完成：${target}\n  数据库 ${(dbSize / 1024 / 1024).toFixed(1)} MB，文件 ${files} 个（${(bytes / 1024 / 1024).toFixed(1)} MB，硬链接不额外占空间）\n` +
      `  删除旧备份 ${old.length} 份，清理回收文件 ${trashed} 个、过期上传 ${stale} 个`,
  )
}
