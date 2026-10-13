export function CanvasPlaceholder() {
  return (
    <div className="canvas-placeholder">
      <div className="canvas-placeholder-grid" aria-hidden />
      <div className="canvas-placeholder-note">
        <p className="canvas-placeholder-title">画布还在开发中</p>
        <p>
          下一个阶段（M3）会在这里做出无限画布：自由摆放文字、图片、视频、文件和表格，用箭头连线。现在可以先建好画布页面、在侧边栏里整理位置，之后内容会出现在这里。
        </p>
      </div>
    </div>
  )
}
