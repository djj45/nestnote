import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/app.css'
import './styles/editor.css'
import './styles/canvas.css'
import './styles/embed.css'
import './styles/print.css'
// 显示偏好（浅色/深色、宽度）尽早生效
import './app/prefs'
// 登录和同步（要在界面之前启动，新设备上需要先等服务器的数据）
import './sync/session'
// 注册命令（顺序决定命令面板和设置页里的分组顺序）
import './commands/builtin'
import './editor/editorCommands'
import './canvas/canvasCommands'
import { App } from './App'
import { isMac } from './lib/platform'
import { registerServiceWorker } from './app/pwa'

document.documentElement.classList.add(isMac ? 'is-mac' : 'is-win')
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
