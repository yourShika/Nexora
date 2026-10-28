import { useState } from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { Check, Copy } from '@phosphor-icons/react'

// Auswahl statt aller ~40 lowlight-Sprachen: das, was im IT-Alltag vorkommt
export const LANGUAGES = {
  powershell: 'PowerShell',
  dos: 'CMD',
  bash: 'Bash',
  python: 'Python',
  sql: 'SQL',
  json: 'JSON',
  yaml: 'YAML',
  xml: 'XML/HTML',
  ini: 'INI',
  dockerfile: 'Dockerfile',
  nginx: 'Nginx',
  csharp: 'C#',
  javascript: 'JavaScript',
  plaintext: 'Text',
}

export function CodeBlockView({ node, updateAttributes }) {
  const [copied, setCopied] = useState(false)
  const lang = node.attrs.language || 'plaintext'

  async function copy() {
    await navigator.clipboard.writeText(node.textContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <NodeViewWrapper className="codeblock">
      <div contentEditable={false} className="flex items-center justify-between border-b border-line px-2 py-1 text-xs">
        <select
          aria-label="Sprache"
          value={LANGUAGES[lang] ? lang : 'plaintext'}
          onChange={(e) => updateAttributes({ language: e.target.value })}
          className="rounded bg-transparent px-1 py-0.5 text-muted hover:bg-hover"
        >
          {Object.entries(LANGUAGES).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <button onClick={copy} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-text">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
      <pre>
        <NodeViewContent as="code" className={`hljs language-${lang}`} />
      </pre>
    </NodeViewWrapper>
  )
}
