import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { looksLikeMarkdown, markdownToHtml } from './markdown'

/** 结构化 HTML（来自网页、Word、本编辑器）照常粘贴；纯文本的 Markdown 转换成对应格式 */
const STRUCTURED_HTML = /<(p|h[1-6]|li|ul|ol|table|blockquote|pre)[\s>]/i

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste: (_view, event) => {
            const data = event.clipboardData
            if (!data) return false
            const text = data.getData('text/plain')
            if (!text) return false
            const html = data.getData('text/html')
            if (html && STRUCTURED_HTML.test(html)) return false
            if (editor.isActive('codeBlock') || !looksLikeMarkdown(text)) return false
            editor.chain().focus().insertContent(markdownToHtml(text)).run()
            return true
          },
        },
      }),
    ]
  },
})
