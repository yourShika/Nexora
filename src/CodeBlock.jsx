import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { Check, Copy, NotePencil, Play, ShieldCheck, Stop, Table, TextAlignLeft, X } from '@phosphor-icons/react'
import * as db from './db.js'
import { useApp } from './ctx.js'
import { RUNNABLE, fill, parseTable, placeholders, runCode } from './runner.js'

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

const MAX_LINES = 5000

export function CodeBlockView({ node, updateAttributes, editor, getPos }) {
  const [copied, setCopied] = useState(false)
  const [run, setRun] = useState(null)
  const [ask, setAsk] = useState(null)
  const app = useApp()
  const lang = node.attrs.language || 'plaintext'
  const runnable = lang in RUNNABLE

  async function copy() {
    await navigator.clipboard.writeText(node.textContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Platzhalter zuerst abfragen; zuletzt benutzte Werte vorbelegen
  async function start(admin) {
    // {{vault:Name}} setzt vault.rs ein; dafür muss der Tresor offen sein
    if (node.textContent.includes('{{vault:') && !(await app?.unlockVault())) return
    const names = placeholders(node.textContent)
    if (!names.length) return go(node.textContent, admin)
    let last = {}
    try {
      last = JSON.parse((await db.getSetting('placeholders')) || '{}')
    } catch {}
    setAsk({ admin, names, values: Object.fromEntries(names.map((n) => [n, last[n] ?? ''])) })
  }

  async function go(code, admin, values) {
    setAsk(null)
    if (values) {
      db.getSetting('placeholders')
        .then((s) => db.setSetting('placeholders', JSON.stringify({ ...JSON.parse(s || '{}'), ...values })))
        .catch(() => {})
    }
    const pwsh = (await db.getSetting('pwsh').catch(() => null)) === '1'
    setRun({ admin, lines: [], running: true, started: new Date(), cancel: null })
    // Zeilen gesammelt pro Bildschirmbild übernehmen, sonst bremst lange Ausgabe die Seite
    let pending = []
    let frame = 0
    const flush = () => {
      frame = 0
      const add = pending
      pending = []
      setRun((r) => r && { ...r, lines: [...r.lines, ...add].slice(-MAX_LINES) })
    }
    const cancel = await runCode({
      lang,
      code: values ? fill(code, values) : code,
      admin,
      pwsh,
      onLine: (l) => {
        pending.push(l)
        frame ||= requestAnimationFrame(flush)
      },
      onExit: (x) => {
        cancelAnimationFrame(frame)
        flush()
        // Arbeitstagebuch: welche Seite, welche Sprache, wie ausgegangen
        const pageId = editor.view.dom.closest('[data-page-id]')?.dataset.pageId
        db.journal('ausgefuehrt', pageId ?? null, `${RUNNABLE[lang] ?? lang}${admin ? ' als Admin' : ''}, ${x.error ? 'Fehler' : `Exit ${x.code}`}`).catch(() => {})
        setRun((r) => r && { ...r, running: false, exit: x.code, ms: x.ms, error: x.error })
      },
    })
    setRun((r) => r && (r.running ? { ...r, cancel } : r))
  }

  // Ausgabe als Absatz + Textblock direkt unter diesem Codeblock einfügen
  function toProtocol() {
    const when = run.started.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
    const text = run.lines.map((l) => l.text).join('\n').replace(/\s+$/, '') || '(keine Ausgabe)'
    const status = run.error ? `Fehler: ${run.error}` : `Exit ${run.exit ?? '?'}, ${(run.ms / 1000).toFixed(1).replace('.', ',')} s${run.admin ? ', als Admin' : ''}`
    editor
      .chain()
      .insertContentAt(getPos() + node.nodeSize, [
        { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Ausgabe' }, { type: 'text', text: ` vom ${when} (${status})` }] },
        { type: 'codeBlock', attrs: { language: 'plaintext' }, content: [{ type: 'text', text }] },
      ])
      .run()
    setRun(null)
  }

  return (
    <NodeViewWrapper className="codeblock">
      <div contentEditable={false} className="flex items-center gap-1 border-b border-line px-2 py-1 text-xs">
        <select
          aria-label="Sprache"
          value={LANGUAGES[lang] ? lang : 'plaintext'}
          onChange={(e) => updateAttributes({ language: e.target.value })}
          disabled={!editor.isEditable}
          className="rounded bg-transparent px-1 py-0.5 text-muted hover:bg-hover"
        >
          {Object.entries(LANGUAGES).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <span className="flex-1" />
        {runnable && (
          <>
            <BarButton onClick={() => start(false)} disabled={run?.running} title="Ausführen" icon={Play} accent>Ausführen</BarButton>
            <BarButton onClick={() => start(true)} disabled={run?.running} title="Als Administrator ausführen (Windows fragt nach)" icon={ShieldCheck}>Als Admin</BarButton>
          </>
        )}
        <BarButton onClick={copy} icon={copied ? Check : Copy}>{copied ? 'Kopiert' : 'Kopieren'}</BarButton>
      </div>
      <pre>
        <NodeViewContent as="code" className={`hljs language-${lang}`} />
      </pre>
      {ask && <AskValues ask={ask} onRun={(values) => go(node.textContent, ask.admin, values)} onCancel={() => setAsk(null)} />}
      {run && <Output run={run} onClose={() => setRun(null)} onProtocol={toProtocol} />}
    </NodeViewWrapper>
  )
}

function BarButton({ onClick, disabled, title, icon: Icon, accent, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover disabled:opacity-40 ${accent ? 'font-medium text-accent' : 'text-muted hover:text-text'}`}
    >
      <Icon size={14} weight={accent ? 'fill' : 'regular'} /> {children}
    </button>
  )
}

function AskValues({ ask, onRun, onCancel }) {
  const [values, setValues] = useState(ask.values)
  return (
    <form
      contentEditable={false}
      onSubmit={(e) => (e.preventDefault(), onRun(values))}
      className="flex flex-wrap items-end gap-3 border-t border-line px-3 py-2.5 text-sm"
    >
      {ask.names.map((n, i) => (
        <label key={n} className="flex flex-col gap-1">
          <span className="text-xs text-muted">{n}</span>
          <input
            autoFocus={i === 0}
            value={values[n]}
            onChange={(e) => setValues({ ...values, [n]: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && onCancel()}
            className="w-44 rounded-md border border-line bg-raised px-2 py-1 font-mono text-xs outline-none focus:border-accent"
          />
        </label>
      ))}
      <button type="submit" className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 font-medium text-white dark:text-bg">
        <Play size={13} weight="fill" /> {ask.admin ? 'Als Admin starten' : 'Starten'}
      </button>
      <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-muted hover:bg-hover">Abbrechen</button>
    </form>
  )
}

function Output({ run, onClose, onProtocol }) {
  const box = useRef(null)
  const table = useMemo(() => (run.running ? null : parseTable(run.lines.map((l) => l.text))), [run.running, run.lines])
  const [asTable, setAsTable] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (run.running && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [run.lines, run.running])

  const ok = !run.running && run.exit === 0 && !run.error
  return (
    <div contentEditable={false} className="border-t border-line text-xs">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1">
        <span className={`mr-1 font-medium ${run.running ? 'text-accent' : ok ? 'text-[color-mix(in_srgb,#3f8f4f_80%,var(--text))]' : 'text-danger'}`} aria-live="polite">
          {run.running ? 'Läuft …' : run.error ? `Fehler: ${run.error}` : `Exit ${run.exit ?? '?'}`}
        </span>
        {!run.running && run.ms != null && <span className="text-faint">{(run.ms / 1000).toFixed(1).replace('.', ',')} s{run.admin ? ', als Admin' : ''}</span>}
        <span className="flex-1" />
        {run.running && <BarButton onClick={() => run.cancel?.()} disabled={!run.cancel} icon={Stop}>Abbrechen</BarButton>}
        {table && <BarButton onClick={() => setAsTable(!asTable)} icon={asTable ? TextAlignLeft : Table}>{asTable ? 'Als Text' : 'Als Tabelle'}</BarButton>}
        {!run.running && (
          <>
            <BarButton
              onClick={() => navigator.clipboard.writeText(run.lines.map((l) => l.text).join('\n')).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
              icon={copied ? Check : Copy}
            >
              {copied ? 'Kopiert' : 'Kopieren'}
            </BarButton>
            <BarButton onClick={onProtocol} icon={NotePencil}>Ins Protokoll</BarButton>
          </>
        )}
        <button aria-label="Ausgabe schließen" onClick={onClose} className="rounded p-0.5 text-muted hover:bg-hover hover:text-text"><X size={14} /></button>
      </div>
      {asTable && table ? (
        <OutputTable table={table} />
      ) : (
        <div ref={box} className="max-h-80 overflow-auto px-3 pb-2 font-mono leading-5" role="log">
          {run.lines.length ? run.lines.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap break-words ${l.err ? 'text-danger' : ''}`}>{l.text || ' '}</div>
          )) : !run.running && <div className="text-faint">(keine Ausgabe)</div>}
        </div>
      )}
    </div>
  )
}

// Sortier- und filterbare Tabelle aus PowerShell-Ausgabe
function OutputTable({ table }) {
  const [sort, setSort] = useState(null)
  const [filter, setFilter] = useState('')
  const rows = useMemo(() => {
    const f = filter.toLowerCase()
    const list = table.rows.filter((r) => !f || r.some((c) => c.toLowerCase().includes(f)))
    if (!sort) return list
    return [...list].sort((a, b) => a[sort.col].localeCompare(b[sort.col], 'de', { numeric: true }) * sort.dir)
  }, [table, sort, filter])
  return (
    <div className="px-3 pb-2">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filtern"
        aria-label="Ausgabe filtern"
        className="mb-1.5 w-48 rounded-md border border-line bg-raised px-2 py-0.5 outline-none focus:border-accent"
      />
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse font-mono">
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th key={i} className="sticky top-0 border-b border-line bg-[var(--code-bg)] px-2 py-1 text-left font-medium">
                  <button onClick={() => setSort(sort?.col === i ? (sort.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 })} className="hover:text-accent">
                    {h}{sort?.col === i ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {r.map((c, j) => <td key={j} className="px-2 py-0.5 align-top">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-faint">{rows.length} von {table.rows.length} Zeilen</p>
    </div>
  )
}
