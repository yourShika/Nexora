import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from '@phosphor-icons/react'
import { CHART_TYPES, GROUPS, SOURCES, foldSlices, fromList, fromRows, num, pageTables, parseSpec, serializeSpec } from './diagram.js'
import { fieldsOf, isDone } from './fields.js'
import { useApp } from './ctx.js'
import { useDark } from './theme.js'
import Select from './Select.jsx'

// Reihenfarben (geprüft auf Farbfehlsichtigkeit, siehe Statistik), feste Reihenfolge
const PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
}
const TYPE = { balken: 'bar', quer: 'bar', gestapelt: 'bar', linie: 'line', flaeche: 'line', torte: 'pie', ring: 'doughnut', punkte: 'scatter', netz: 'radar', polar: 'polarArea' }
const ROUND = new Set(['torte', 'ring', 'polar'])

// Chart.js erst laden, wenn ein Diagramm auf der Seite ist
let lib
const loadChart = () => (lib ??= import('chart.js/auto').then((m) => m.default))

function config(spec, data, dark) {
  const css = getComputedStyle(document.documentElement)
  const v = (name) => css.getPropertyValue(name).trim()
  const colors = PALETTE[dark ? 'dark' : 'light']
  const round = ROUND.has(spec.typ)
  const d = round ? foldSlices(data) : data
  const type = TYPE[spec.typ] ?? 'bar'
  const datasets = round
    ? [{ label: d.series[0]?.name ?? '', data: d.series[0]?.values ?? [], backgroundColor: colors.slice(0, d.labels.length), borderColor: v('--raised'), borderWidth: 2 }]
    : d.series.slice(0, 8).map((s, i) => {
        const c = colors[i]
        if (spec.typ === 'punkte') return { label: s.name, data: d.labels.map((l, j) => ({ x: num(l) ?? j + 1, y: s.values[j] })), backgroundColor: c, pointRadius: 5 }
        if (type === 'line' || type === 'radar') return { label: s.name, data: s.values, borderColor: c, backgroundColor: `${c}33`, fill: spec.typ === 'flaeche' || type === 'radar', tension: 0.3, pointRadius: 4, borderWidth: 2 }
        return { label: s.name, data: s.values, backgroundColor: c, borderRadius: 4, maxBarThickness: 48 }
      })
  const axes = !round && type !== 'radar'
  const scale = { grid: { color: v('--line') }, ticks: { color: v('--muted') }, border: { color: v('--line') }, stacked: spec.typ === 'gestapelt' }
  return {
    type,
    data: { labels: d.labels, datasets },
    options: {
      animation: false, // druckt sofort richtig
      maintainAspectRatio: false,
      indexAxis: spec.typ === 'quer' ? 'y' : 'x',
      scales: axes ? { x: scale, y: { ...scale, beginAtZero: true } } : type === 'radar' ? { r: { grid: { color: v('--line') }, angleLines: { color: v('--line') }, pointLabels: { color: v('--muted') }, ticks: { color: v('--muted'), backdropColor: 'transparent' } } } : {},
      plugins: {
        legend: { display: round || datasets.length > 1, labels: { color: v('--text') } },
        title: { display: !!spec.titel, text: spec.titel, color: v('--text'), font: { size: 15, weight: '600' } },
      },
    },
  }
}

// Diagramm-Block: Anzeige und (bearbeitbar) Einstellungen; onChange bekommt den neuen Text des Codeblocks
export function ChartBlock({ code, editor, editable, editing, onChange }) {
  const spec = useMemo(() => parseSpec(code), [code])
  const app = useApp()
  const dark = useDark()
  const canvas = useRef(null)
  const [ready, setReady] = useState(false)
  const [pageMd, setPageMd] = useState('')

  // Tabelle dieser Seite: bei Änderungen am Text neu lesen
  useEffect(() => {
    if (spec.quelle !== 'seite') return
    let t
    const read = () => {
      clearTimeout(t)
      t = setTimeout(() => setPageMd(editor.getMarkdown()), 300)
    }
    setPageMd(editor.getMarkdown())
    editor.on('update', read)
    return () => {
      clearTimeout(t)
      editor.off('update', read)
    }
  }, [editor, spec.quelle])

  const list = spec.quelle === 'liste' ? app?.alive.get(spec.liste) : null
  const rows = list ? app.rowsOf(list.id) : null
  const tables = useMemo(() => (spec.quelle === 'seite' ? pageTables(pageMd) : []), [spec.quelle, pageMd])
  const data = useMemo(() => {
    if (spec.quelle === 'liste') {
      if (!list) return { error: 'Liste auswählen' }
      const fields = fieldsOf(list)
      return fromList(rows, fields, spec.gruppe, spec.nur, (r) => isDone(r, fields))
    }
    if (spec.quelle === 'seite') return tables[spec.seite - 1] ? fromRows(tables[spec.seite - 1]) : { error: tables.length ? `Die Seite hat nur ${tables.length} Tabelle(n)` : 'Die Seite hat noch keine Tabelle' }
    return fromRows(spec.rows)
  }, [spec, list, rows, tables])

  // nur neu zeichnen, wenn sich die Zahlen ändern (Punkte einer Liste kommen bei jeder Änderung als neues Array)
  const key = JSON.stringify(data)
  useEffect(() => {
    if (data.error || !data.series?.length || !canvas.current) return
    let chart
    let alive = true
    loadChart().then((Chart) => {
      if (!alive || !canvas.current) return
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily
      chart = new Chart(canvas.current, config(spec, data, dark))
      setReady(true)
    })
    return () => {
      alive = false
      chart?.destroy()
    }
  }, [key, spec.typ, spec.titel, dark])

  const set = (patch) => onChange(serializeSpec({ ...spec, ...patch }))
  const empty = !data.error && !data.series?.length
  return (
    <div contentEditable={false}>
      {editable && editing && <Settings spec={spec} set={set} databases={app?.databases ?? []} tables={tables} />}
      <div className="px-3 py-3">
        {data.error || empty ? (
          <p className="py-6 text-center text-sm text-muted">{data.error ?? 'Noch keine Zahlen: oben unter „Bearbeiten“ eintragen.'}</p>
        ) : (
          <div className="relative h-72">
            {!ready && <p data-pending className="absolute inset-0 grid place-items-center text-xs text-faint">Diagramm wird gezeichnet …</p>}
            <canvas ref={canvas} role="img" aria-label={spec.titel || 'Diagramm'} />
          </div>
        )}
      </div>
    </div>
  )
}

const field = 'rounded-md border border-line bg-raised px-2 py-1 text-sm outline-none focus:border-accent'

function Settings({ spec, set, databases, tables }) {
  return (
    <div className="space-y-3 border-b border-line px-3 py-3 text-sm">
      <div role="radiogroup" aria-label="Art" className="flex flex-wrap gap-1">
        {CHART_TYPES.map(([id, name]) => (
          <button key={id} role="radio" aria-checked={spec.typ === id} onClick={() => set({ typ: id })} className={`rounded-md px-2 py-1 ${spec.typ === id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-text'}`}>
            {name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          Titel <input value={spec.titel} onChange={(e) => set({ titel: e.target.value })} className={`${field} w-56`} />
        </label>
        <label className="flex items-center gap-2">
          Daten
          <Select value={spec.quelle} onChange={(e) => set({ quelle: e.target.value })} className={field}>
            {SOURCES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </label>
        {spec.quelle === 'liste' && (
          <>
            <Select aria-label="Liste" value={spec.liste} onChange={(e) => set({ liste: e.target.value })} className={field}>
              <option value="">Liste wählen …</option>
              {databases.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Select>
            <Select aria-label="Gruppieren nach" value={spec.gruppe} onChange={(e) => set({ gruppe: e.target.value })} className={field}>
              {GROUPS.map(([id, name]) => <option key={id} value={id}>nach {name}</option>)}
            </Select>
            <Select aria-label="Welche Punkte" value={spec.nur} onChange={(e) => set({ nur: e.target.value })} className={field}>
              <option value="offen">nur offene</option>
              <option value="alle">alle</option>
            </Select>
          </>
        )}
        {spec.quelle === 'seite' && (
          <Select aria-label="Tabelle" value={spec.seite} onChange={(e) => set({ seite: Number(e.target.value) })} className={field}>
            {(tables.length ? tables : [[['–']]]).map((t, i) => (
              <option key={i} value={i + 1}>{i + 1}. Tabelle ({t[0]?.slice(0, 3).join(', ')})</option>
            ))}
          </Select>
        )}
      </div>
      {spec.quelle === 'tabelle' && <Grid rows={spec.rows} onRows={(rows) => set({ rows })} />}
    </div>
  )
}

// Kleine Tabelle zum Eintippen; Einfügen aus Excel (Tabs und Zeilenumbrüche) füllt ab der Zelle
function Grid({ rows, onRows }) {
  const width = Math.max(2, ...rows.map((r) => r.length))
  const grid = (rows.length ? rows : [['Kategorie', 'Wert'], ['', '']]).map((r) => Array.from({ length: width }, (_, j) => r[j] ?? ''))
  const put = (i, j, value) => onRows(grid.map((r, a) => (a === i ? r.map((c, b) => (b === j ? value : c)) : r)))
  function paste(e, i, j) {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.trim())) return
    e.preventDefault()
    const block = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    const next = grid.map((r) => [...r])
    block.forEach((line, a) =>
      line.forEach((cell, b) => {
        while (next.length <= i + a) next.push(Array.from({ length: width }, () => ''))
        for (const r of next) while (r.length <= j + b) r.push('')
        next[i + a][j + b] = cell.trim()
      }),
    )
    onRows(next)
  }
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse">
        <tbody>
          {grid.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="p-0.5">
                  <input
                    value={c}
                    aria-label={`Zeile ${i + 1}, Spalte ${j + 1}`}
                    placeholder={i === 0 ? (j === 0 ? 'Beschriftung' : `Reihe ${j}`) : ''}
                    onChange={(e) => put(i, j, e.target.value)}
                    onPaste={(e) => paste(e, i, j)}
                    className={`${field} w-28 ${i === 0 || j === 0 ? 'font-medium' : 'text-right tabular-nums'}`}
                  />
                </td>
              ))}
              <td>
                {i > 0 && (
                  <button aria-label="Zeile löschen" onClick={() => onRows(grid.filter((_, a) => a !== i))} className="rounded p-1 text-faint hover:text-danger">
                    <X size={13} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex gap-2">
        <button onClick={() => onRows([...grid, Array.from({ length: width }, () => '')])} className="flex items-center gap-1 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-text"><Plus size={13} /> Zeile</button>
        <button onClick={() => onRows(grid.map((r) => [...r, '']))} className="flex items-center gap-1 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-text"><Plus size={13} /> Reihe</button>
        {width > 2 && <button onClick={() => onRows(grid.map((r) => r.slice(0, -1)))} className="rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-text">Letzte Reihe entfernen</button>}
        <span className="self-center text-xs text-faint">Tipp: Bereich aus Excel kopieren und in eine Zelle einfügen.</span>
      </div>
    </div>
  )
}
