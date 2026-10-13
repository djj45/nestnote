import { Download, ExternalLink, File, FileMusic, FileText, FileVideoCamera, ImageOff } from 'lucide-react'
import { kindForMime, missingAssetHint, useAssetMeta, useAssetUrl } from '../assets/assetStore'
import { formatBytes } from '../lib/format'

/**
 * 画布上的图片、视频、音频、文件。
 * 视频、音频、文件卡片有一条标题栏，用来拖动；播放器和按钮在选中后才能点（data-interactive）。
 */
export function MediaCardBody({ assetId, selected }: { assetId: string | null; selected: boolean }) {
  const { url, status } = useAssetUrl(assetId)
  const meta = useAssetMeta(assetId)
  const kind = meta ? kindForMime(meta.mime) : 'file'
  const name = meta?.name ?? '文件'

  if (!url && status !== 'loading') {
    return (
      <div className="media-missing card-missing">
        <ImageOff className="icon" />
        <span>{name ? `“${name}”` : '这个文件'}{missingAssetHint()}</span>
      </div>
    )
  }

  if (kind === 'image') {
    const ratio = meta?.width && meta?.height ? `${meta.width} / ${meta.height}` : undefined
    return url ? (
      <img className="card-image" src={url} alt={name} draggable={false} style={{ aspectRatio: ratio }} />
    ) : (
      <div className="card-loading" style={{ aspectRatio: ratio ?? '4 / 3' }} />
    )
  }

  const Icon = kind === 'video' ? FileVideoCamera : kind === 'audio' ? FileMusic : meta?.mime === 'application/pdf' ? FileText : File
  return (
    <div className="card-media">
      <div className="card-media-bar">
        <Icon className="icon" />
        <span className="card-media-name">{name}</span>
        {meta && <span className="card-media-size">{formatBytes(meta.size)}</span>}
        {url && (
          <span className="card-media-actions" data-interactive="">
            <a className="tool-btn" href={url} target="_blank" rel="noreferrer" title="在新标签页打开" aria-label="在新标签页打开">
              <ExternalLink className="icon" />
            </a>
            <a className="tool-btn" href={url} download={name} title="下载" aria-label="下载">
              <Download className="icon" />
            </a>
          </span>
        )}
      </div>
      {url && kind === 'video' && (
        <video className="card-video" src={url} controls preload="metadata" playsInline {...(selected ? { 'data-interactive': '' } : {})} />
      )}
      {url && kind === 'audio' && (
        <audio className="card-audio" src={url} controls preload="metadata" {...(selected ? { 'data-interactive': '' } : {})} />
      )}
    </div>
  )
}
