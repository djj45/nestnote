import { FilePlus2, Shapes } from 'lucide-react'
import { usePages } from '../store/hooks'
import { getAncestors } from '../store/workspace'
import { navigate, paths } from '../lib/router'
import { formatTime } from '../lib/format'
import { runCommand } from '../commands/registry'
import { useReadOnly } from './readOnly'
import { CommandKbd } from './Kbd'
import { PageIcon } from './PageIcon'

export function HomeView() {
  const snap = usePages()
  const readOnly = useReadOnly()
  const recent = [...snap.visible]
    .map((id) => snap.byId.get(id)!)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12)

  return (
    <div className="view-scroll">
      <div className="home">
        {!readOnly && <div className="home-create">
          <button className="create-card" onClick={() => runCommand('page.newDoc')}>
            <FilePlus2 className="icon" />
            <span className="create-title">新建文档</span>
            <span className="create-desc">写字、列清单、插表格和代码</span>
            <CommandKbd commandId="page.newDoc" />
          </button>
          <button className="create-card" onClick={() => runCommand('page.newCanvas')}>
            <Shapes className="icon" />
            <span className="create-title">新建画布</span>
            <span className="create-desc">自由摆放文字、图片和文档</span>
            <CommandKbd commandId="page.newCanvas" />
          </button>
        </div>}

        {recent.length > 0 ? (
          <section className="home-section">
            <h2>最近编辑</h2>
            <ul className="recent-list">
              {recent.map((page) => {
                const path = getAncestors(page.id)
                  .map((p) => p.title || '无标题')
                  .join(' / ')
                return (
                  <li key={page.id}>
                    <button className="recent-item" onClick={() => navigate(paths.page(page.id))}>
                      <PageIcon type={page.type} />
                      <span className="recent-title">{page.title || '无标题'}</span>
                      {path && <span className="recent-path">{path}</span>}
                      <span className="recent-time">{formatTime(page.updatedAt)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : (
          <section className="home-section home-tips">
            <h2>开始使用</h2>
            <ul>
              <li>
                <CommandKbd commandId="app.quickOpen" /> 搜索并跳转到任何页面
              </li>
              <li>
                <CommandKbd commandId="app.commandPalette" /> 打开命令面板，所有功能都在里面
              </li>
              <li>
                在文档里输入 <kbd>/</kbd> 或 <kbd>、</kbd> 插入标题、列表、表格等
              </li>
              <li>侧边栏里的页面可以拖动排序，拖到另一个页面上会变成它的子页面</li>
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
