import { useState, type FormEvent } from 'react'
import { useStore } from '../lib/store'
import { isLocalhost, login, session, skipLogin } from '../sync/session'
import { OfflineError } from '../sync/api'

export function LoginView() {
  const { expired } = useStore(session)
  const [username, setUsername] = useState(() => localStorage.getItem('note:sync:account') ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err instanceof OfflineError ? '连不上服务器，请检查网络' : err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>笔记</h1>
        <p className="login-desc">
          {expired ? '登录已失效，请重新登录。本机的笔记还在，登录后会继续同步。' : '登录后，笔记会在你的各台设备之间同步。'}
        </p>
        <label className="login-field">
          <span>用户名</span>
          <input
            className="input"
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus={!username}
          />
        </label>
        <label className="login-field">
          <span>密码</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={!!username}
          />
        </label>
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary login-submit" type="submit" disabled={busy}>
          {busy ? '正在登录…' : '登录'}
        </button>
        {isLocalhost && (
          <button type="button" className="login-skip" onClick={skipLogin}>
            暂不登录，只在本机使用
          </button>
        )}
      </form>
    </div>
  )
}
