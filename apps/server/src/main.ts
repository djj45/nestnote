import readline from 'node:readline'
import { config } from './config.ts'
import { getDb } from './db.ts'
import { hasAnyUser, setPassword } from './auth.ts'
import { createServer } from './server.ts'
import { runBackup } from './backup.ts'

/**
 * 用法：
 *   server.mjs serve                     启动服务
 *   server.mjs set-password <用户名>       设置（或修改）密码，会提示输入两次
 *   server.mjs backup [目录] [保留份数]     备份数据库和文件
 */

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
    if (hidden && process.stdin.isTTY) {
      // 输入密码时不回显
      const out = rl as unknown as { _writeToOutput: (s: string) => void }
      let prompted = false
      out._writeToOutput = (s: string) => {
        if (!prompted) {
          process.stdout.write(s)
          prompted = true
        }
      }
    }
    rl.question(question, (answer) => {
      rl.close()
      if (hidden && process.stdin.isTTY) process.stdout.write('\n')
      resolve(answer)
    })
  })
}

async function main() {
  const [command = 'serve', ...args] = process.argv.slice(2)

  if (command === 'serve') {
    getDb()
    const server = createServer()
    await server.listen()
    console.log(`笔记服务已启动：http://${config.host}:${config.port}  数据目录：${config.dataDir}`)
    console.log(`允许的网页来源：${config.origins.join(', ')}`)
    if (!hasAnyUser()) console.warn('还没有设置账号，请运行：server.mjs set-password <用户名>')
    let stopping = false
    const stop = async () => {
      if (stopping) return
      stopping = true
      console.log('正在停止…')
      await server.shutdown()
      process.exit(0)
    }
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
    return
  }

  if (command === 'set-password') {
    const username = (args[0] ?? '').trim()
    if (!/^[A-Za-z0-9_.@-]{1,40}$/.test(username)) {
      console.error('用法：set-password <用户名>（字母、数字、_.@-）')
      process.exit(1)
    }
    const first = await ask(`给 ${username} 设置新密码：`, true)
    if (first.length < 8) {
      console.error('密码至少 8 位')
      process.exit(1)
    }
    if (process.stdin.isTTY) {
      const second = await ask('再输入一次：', true)
      if (first !== second) {
        console.error('两次输入不一样，没有修改')
        process.exit(1)
      }
    }
    await setPassword(username, first)
    console.log(`已设置 ${username} 的密码。所有设备需要重新登录。`)
    return
  }

  if (command === 'backup') {
    const dest = args[0] || process.env.NOTE_BACKUP_DIR || './backups'
    const keep = Number(args[1] || process.env.NOTE_BACKUP_KEEP || 14)
    await runBackup(dest, keep)
    return
  }

  console.error(`不认识的命令：${command}`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
