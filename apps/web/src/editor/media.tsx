import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import {
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  ImageOff,
  Maximize2,
} from 'lucide-react'
import { missingAssetHint, useAssetMeta, useAssetUrl } from '../assets/assetStore'
import { openLightbox } from '../app/Lightbox'
import { cls, formatBytes } from '../lib/format'

/**
 * 文档里的图片、视频、音频、文件块。
 * 内容存在资源库里（assetId 是文件内容的哈希），文档里只记 id。
 * 从网页粘贴来的图片没有 assetId，用 src 记原始地址。
 */

const assetIdAttr = {
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute('data-asset-id'),
  renderHTML: (attrs: Record<string, unknown>) => (attrs.assetId ? { 'data-asset-id': attrs.assetId } : {}),
}

const widthAttr = {
  default: null,
  parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-width')) || null,
  renderHTML: (attrs: Record<string, unknown>) => (attrs.width ? { 'data-width': attrs.width } : {}),
}

// ---------------- 可调宽度的外框 ----------------

function ResizableFrame({
  width,
  editable,
  onResize,
  children,
}: {
  width: number | null
  editable: boolean
  onResize: (width: number | null) => void
  children: ReactNode
}) {
  const frameRef = useRef<HTMLDivElement>(null)

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const frame = frameRef.current
    const container = frame?.parentElement
    if (!frame || !container) return
    const startX = e.clientX
    const startWidth = frame.getBoundingClientRect().width
    const maxWidth = container.getBoundingClientRect().width
    if (maxWidth < 100) return
    let current = startWidth
    const move = (ev: PointerEvent) => {
      current = Math.max(80, Math.min(maxWidth, startWidth + ev.clientX - startX))
      frame.style.width = `${current}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const next = current >= maxWidth - 2 ? null : Math.round(current)
      // 拖动时直接改了 style，结束后按最终值写回（铺满时清掉，交给 CSS）
      frame.style.width = next ? `${next}px` : ''
      onResize(next)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={frameRef} className="media-frame" style={{ width: width ? `${width}px` : undefined }}>
      {children}
      {editable && <span className="media-resize" onPointerDown={startResize} title="拖动调整宽度" />}
    </div>
  )
}

function Missing({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <div className="media-missing">
      {icon ?? <ImageOff className="icon" />}
      <span>{text}</span>
    </div>
  )
}

// ---------------- 图片 ----------------

function ImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { assetId, src, alt, width } = node.attrs as { assetId: string | null; src: string | null; alt: string | null; width: number | null }
  const { url, status } = useAssetUrl(assetId)
  const meta = useAssetMeta(assetId)
  const finalUrl = assetId ? url : src
  const ratio = meta?.width && meta?.height ? `${meta.width} / ${meta.height}` : undefined

  return (
    <NodeViewWrapper className={cls('media media-image', selected && 'is-selected')} data-drag-handle="">
      <ResizableFrame width={width} editable={editor.isEditable} onResize={(w) => updateAttributes({ width: w })}>
        {finalUrl ? (
          <>
            <img
              src={finalUrl}
              alt={alt ?? meta?.name ?? ''}
              draggable={false}
              style={{ aspectRatio: ratio }}
              onDoubleClick={() => openLightbox(finalUrl, alt ?? meta?.name ?? '')}
            />
            <button
              className="media-zoom"
              title="查看大图"
              aria-label="查看大图"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openLightbox(finalUrl, alt ?? meta?.name ?? '')}
            >
              <Maximize2 className="icon" />
            </button>
          </>
        ) : status === 'loading' && assetId ? (
          <div className="media-loading" style={{ aspectRatio: ratio ?? '16 / 9' }} />
        ) : (
          <Missing text={`这张图片${missingAssetHint()}`} />
        )}
      </ResizableFrame>
    </NodeViewWrapper>
  )
}

export const ImageBlock = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      assetId: assetIdAttr,
      src: { default: null },
      alt: { default: null },
      width: widthAttr,
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-asset-id]' }, { tag: 'img[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})

// ---------------- 视频 ----------------

function VideoView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { assetId, width } = node.attrs as { assetId: string | null; width: number | null }
  const { url, status } = useAssetUrl(assetId)
  const meta = useAssetMeta(assetId)
  const ratio = meta?.width && meta?.height ? `${meta.width} / ${meta.height}` : '16 / 9'

  return (
    <NodeViewWrapper className={cls('media media-video', selected && 'is-selected')} data-drag-handle="">
      <ResizableFrame width={width} editable={editor.isEditable} onResize={(w) => updateAttributes({ width: w })}>
        {url ? (
          <video src={url} controls preload="metadata" playsInline style={{ aspectRatio: ratio }} />
        ) : status === 'loading' ? (
          <div className="media-loading" style={{ aspectRatio: ratio }} />
        ) : (
          <Missing icon={<FileVideoCamera className="icon" />} text={`这个视频${missingAssetHint()}`} />
        )}
      </ResizableFrame>
      {meta && <div className="media-caption">{meta.name}</div>}
    </NodeViewWrapper>
  )
}

export const VideoBlock = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { assetId: assetIdAttr, width: widthAttr }
  },

  parseHTML() {
    return [{ tag: 'video[data-asset-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'true' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoView)
  },
})

// ---------------- 音频 ----------------

function AudioView({ node, selected }: NodeViewProps) {
  const { assetId } = node.attrs as { assetId: string | null }
  const { url, status } = useAssetUrl(assetId)
  const meta = useAssetMeta(assetId)
  return (
    <NodeViewWrapper className={cls('media media-audio', selected && 'is-selected')} data-drag-handle="">
      <div className="audio-card">
        <FileMusic className="icon" />
        <span className="file-name">{meta?.name ?? '音频'}</span>
        {url ? (
          <audio src={url} controls preload="metadata" />
        ) : (
          <span className="file-meta">{status === 'loading' ? '加载中…' : missingAssetHint()}</span>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const AudioBlock = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return { assetId: assetIdAttr }
  },

  parseHTML() {
    return [{ tag: 'audio[data-asset-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(HTMLAttributes, { controls: 'true' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioView)
  },
})

// ---------------- 文件 ----------------

function fileIcon(mime: string, name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (mime === 'application/pdf' || ext === 'pdf') return FileText
  if (mime.startsWith('image/')) return FileImage
  if (mime.startsWith('video/')) return FileVideoCamera
  if (mime.startsWith('audio/')) return FileMusic
  if (/zip|rar|7z|tar|gzip/.test(mime) || ['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return FileArchive
  if (/sheet|excel|csv/.test(mime) || ['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return FileSpreadsheet
  if (/json|javascript|xml|html/.test(mime) || ['js', 'ts', 'py', 'json', 'html', 'css', 'sh'].includes(ext)) return FileCode
  if (/word|document|text/.test(mime) || ['doc', 'docx', 'txt', 'md', 'pages'].includes(ext)) return FileText
  return File
}

function FileView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { assetId, name: storedName, preview } = node.attrs as {
    assetId: string | null
    name: string | null
    preview: boolean
  }
  const { url, status } = useAssetUrl(assetId)
  const meta = useAssetMeta(assetId)
  const name = meta?.name ?? storedName ?? '文件'
  const mime = meta?.mime ?? ''
  const isPdf = mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
  const Icon = fileIcon(mime, name)

  return (
    <NodeViewWrapper className={cls('media media-file', selected && 'is-selected')} data-drag-handle="">
      <div className="file-card">
        <span className="file-icon">
          <Icon className="icon" />
        </span>
        <span className="file-text">
          <span className="file-name">{name}</span>
          <span className="file-meta">
            {meta ? formatBytes(meta.size) : ''}
            {status === 'missing' && missingAssetHint()}
          </span>
        </span>
        {url && (
          <span className="file-actions" onMouseDown={(e) => e.preventDefault()}>
            {isPdf && (
              <button
                className="tool-btn"
                title={preview ? '收起预览' : '在文档里预览'}
                aria-label={preview ? '收起预览' : '在文档里预览'}
                disabled={!editor.isEditable && !preview}
                onClick={() => updateAttributes({ preview: !preview })}
              >
                {preview ? <EyeOff className="icon" /> : <Eye className="icon" />}
              </button>
            )}
            <a className="tool-btn" href={url} target="_blank" rel="noreferrer" title="在新标签页打开" aria-label="在新标签页打开">
              <ExternalLink className="icon" />
            </a>
            <a className="tool-btn" href={url} download={name} title="下载" aria-label="下载">
              <Download className="icon" />
            </a>
          </span>
        )}
      </div>
      {isPdf && preview && url && <iframe className="file-preview" src={url} title={name} />}
    </NodeViewWrapper>
  )
}

export const FileBlock = Node.create({
  name: 'fileBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      assetId: assetIdAttr,
      name: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-name'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.name ? { 'data-name': attrs.name } : {}),
      },
      preview: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-preview') === 'true',
        renderHTML: (attrs: Record<string, unknown>) => (attrs.preview ? { 'data-preview': 'true' } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-file-block]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file-block': '' }), node.attrs.name ?? '文件']
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileView)
  },
})

export const MEDIA_NODES = [ImageBlock, VideoBlock, AudioBlock, FileBlock]
