import { useEffect, useState } from 'react'
import { Check, Copy, Plus, Trash, X } from '@phosphor-icons/react'
import { activeProvider, hostOf, isLocal, mcpSnippet, newProvider, PLACEHOLDER, presetOf, PRESETS, problemOf, removeProvider, SYSTEM, userMessage } from './ai.js'
import { aiSettings, complete, hasKey, listModels, loadAi, loadMcp, mcpCommand, onAiChange, saveAi, saveMcp, setKey } from './aiClient.js'
import Select from './Select.jsx'

const FIELD ='w-full rounded-md border border-line bg-raised px-2 py-1 outline-none placeholder:text-faint focus:border-accent'

// Eintrag eines Anbieters: Adresse, Schlüssel, Modell, Verbindung testen
function ProviderForm({ provider, onChange, onRemove }) {
  const preset = presetOf(provider)
  const [keyInput, setKeyInput] = useState('')
  const [stored, setStored] = useState(false)
  const [models, setModels] = useState([])
  const [status, setStatus] = useState(null) // { ok, text }
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    hasKey(provider.id).then((v) => alive && setStored(v)).catch(() => {})
    return () => {
      alive = false
    }
  }, [provider.id])

  async function storeKey(value) {
    try {
      await setKey(provider.id, value)
      setStored(!!value.trim())
      setKeyInput('')
      setStatus(null)
    } catch (e) {
      setStatus({ ok: false, text: `Schlüssel nicht gespeichert: ${e}` })
    }
  }
  async function loadModels() {
    setBusy(true)
    setStatus(null)
    try {
      const list = await listModels(provider)
      setModels(list)
      // leeres oder unbekanntes Modell: das erste vorhandene eintragen, sonst scheitert jede Anfrage
      const pick = list.length && !list.includes(provider.model.trim()) ? list[0] : null
      if (pick) onChange({ model: pick })
      setStatus({ ok: true, text: !list.length ? 'Der Anbieter nennt keine Modelle, bitte von Hand eintragen.' : `${list.length} Modelle gefunden${pick ? `, „${pick}“ eingetragen` : ''}. Im Feld „Modell“ kannst du ein anderes auswählen.` })
    } catch (e) {
      setStatus({ ok: false, text: String(e) })
    } finally {
      setBusy(false)
    }
  }
  async function test() {
    const problem = problemOf(provider, stored)
    if (problem) return setStatus({ ok: false, text: problem })
    setBusy(true)
    setStatus(null)
    try {
      await complete(provider, SYSTEM, userMessage('Antworte nur mit dem Wort: OK', 'Verbindungstest'))
      setStatus({ ok: true, text: 'Die Verbindung steht.' })
    } catch (e) {
      setStatus({ ok: false, text: String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
      <label className="block">
        <span className="mb-0.5 block text-sm text-muted">Name</span>
        <input value={provider.name} onChange={(e) => onChange({ name: e.target.value })} className={FIELD} />
      </label>
      <label className="block">
        <span className="mb-0.5 block text-sm text-muted">Adresse</span>
        <input value={provider.base} onChange={(e) => onChange({ base: e.target.value })} placeholder="https://…/v1" spellCheck="false" className={`${FIELD} font-mono text-sm`} />
        {preset.hint && (!PLACEHOLDER.test(preset.base) || PLACEHOLDER.test(provider.base)) && <span className="mt-0.5 block text-sm text-muted">{preset.hint}</span>}
      </label>
      <div>
        <span className="mb-0.5 block text-sm text-muted">API-Schlüssel{!preset.key && ' (optional)'}</span>
        {stored ? (
          <div className="flex items-center gap-2 text-sm">
            <Check size={16} className="text-accent" /> Gespeichert, nur für deinen Windows-Benutzer lesbar.
            <button onClick={() => storeKey('')} className="rounded-md px-2 py-0.5 text-muted hover:bg-hover">Entfernen</button>
          </div>
        ) : (
          <form onSubmit={(e) => (e.preventDefault(), keyInput.trim() && storeKey(keyInput))} className="flex gap-2">
            <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} autoComplete="off" aria-label="API-Schlüssel" className={`${FIELD} font-mono text-sm`} />
            <button disabled={!keyInput.trim()} className="rounded-md border border-line px-3 py-1 hover:bg-hover disabled:opacity-50">Speichern</button>
          </form>
        )}
      </div>
      <div>
        <span className="mb-0.5 block text-sm text-muted">Modell</span>
        <div className="flex gap-2">
          <input list={`modelle-${provider.id}`} value={provider.model} onChange={(e) => onChange({ model: e.target.value })} placeholder={preset.modelHint} aria-label="Modell" spellCheck="false" className={`${FIELD} font-mono text-sm`} />
          <datalist id={`modelle-${provider.id}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
          <button onClick={loadModels} disabled={busy || !provider.base.trim()} className="shrink-0 rounded-md border border-line px-3 py-1 hover:bg-hover disabled:opacity-50">Modelle laden</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={test} disabled={busy} className="rounded-md border border-line px-3 py-1 hover:bg-hover disabled:opacity-50">{busy ? 'Einen Moment …' : 'Verbindung testen'}</button>
        <button onClick={onRemove} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-danger"><Trash size={15} /> Anbieter entfernen</button>
      </div>
      {!isLocal(provider.base) && hostOf(provider.base) && <p className="text-sm text-muted">Texte, die du an diesen Anbieter schickst, verlassen den PC und gehen an {hostOf(provider.base)}.</p>}
      {status && <p role={status.ok ? 'status' : 'alert'} className={`break-words text-sm ${status.ok ? 'text-accent' : 'text-danger'}`}>{status.text}</p>}
    </div>
  )
}

function ProvidersSection() {
  const [, redraw] = useState(0)
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState('openai')
  const [message, setMessage] = useState('')
  useEffect(() => {
    const off = onAiChange(() => redraw((n) => n + 1))
    loadAi().catch(() => {})
    return off
  }, [])
  const settings = aiSettings()
  const active = activeProvider(settings)
  const guard = (p) => p.catch((e) => setMessage(`Nicht gespeichert: ${e}`))
  const change = (id, fields) => guard(saveAi({ ...settings, providers: settings.providers.map((p) => (p.id === id ? { ...p, ...fields } : p)) }))

  function add() {
    const p = newProvider(adding, crypto.randomUUID())
    guard(saveAi({ ...settings, providers: [...settings.providers, p], active: settings.active ?? p.id }))
    setOpen(p.id)
  }
  function remove(id) {
    setKey(id, '').catch(() => {})
    guard(saveAi(removeProvider(settings, id)))
    setOpen(null)
  }

  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">KI in Nexora</h2>
      <p className="mb-3 text-muted">
        Text in einer Seite markieren, dann auf „KI“ neben der Markierung oder Strg+J. Das Ergebnis erscheint zuerst als Vorschau. Es geht nur der markierte Text an den gewählten Anbieter, und nur, wenn du einen Befehl auslöst.
      </p>
      {settings.providers.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {settings.providers.map((p) => (
            <li key={p.id} className="rounded-lg border border-line bg-raised px-3 py-2">
              <div className="flex items-center gap-3">
                <input type="radio" name="ki-anbieter" checked={active?.id === p.id} onChange={() => guard(saveAi({ ...settings, active: p.id }))} aria-label={`${p.name} verwenden`} className="size-4 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1 truncate">{p.name}<span className="ml-2 text-sm text-muted">{p.model || 'kein Modell'} · {hostOf(p.base) || 'keine Adresse'}</span></span>
                <button onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id} className="rounded-md px-2 py-0.5 text-sm text-muted hover:bg-hover">{open === p.id ? 'Zuklappen' : 'Bearbeiten'}</button>
              </div>
              {open === p.id && <ProviderForm provider={p} onChange={(f) => change(p.id, f)} onRemove={() => remove(p.id)} />}
            </li>
          ))}
        </ul>
      )}
      <div className="mb-6 flex items-center gap-2">
        <Select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Anbieter wählen" className="rounded-md border border-line bg-raised px-2 py-1">
          {PRESETS.map((p) => <option key={p.preset} value={p.preset}>{p.name}</option>)}
        </Select>
        <button onClick={add} className="flex items-center gap-1.5 rounded-md border border-line bg-raised px-3 py-1 hover:border-faint"><Plus size={15} /> Anbieter hinzufügen</button>
      </div>
      <h3 className="mb-1 font-medium">Eigene Anweisungen</h3>
      <p className="mb-2 text-sm text-muted">Stehen im KI-Menü unter den festen Befehlen. Neue speicherst du im Fenster „Eigene Anweisung“.</p>
      {settings.prompts.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {settings.prompts.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-md border border-line bg-raised py-1 pl-3 pr-1 text-sm">
              <span className="font-medium">{p.label}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{p.prompt}</span>
              <button onClick={() => guard(saveAi({ ...settings, prompts: settings.prompts.filter((x) => x.id !== p.id) }))} aria-label={`${p.label} entfernen`} className="rounded p-0.5 text-faint hover:text-danger"><X size={13} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-faint">Noch keine gespeichert.</p>}
      {message && <p role="alert" className="mt-2 text-danger">{message}</p>}
    </section>
  )
}

const MCP_OPTIONS = [
  ['read', 'Lesen und suchen', 'Seiten und Listenpunkte finden und lesen. Was nach Passwort aussieht, wird maskiert.'],
  ['create', 'Neu anlegen', 'Neue Seiten und Listenpunkte anlegen. Vorhandenes bleibt unberührt.'],
  ['edit', 'Bearbeiten', 'Vorhandene Seiten und Punkte ändern, aber nichts löschen. Gesperrte Seiten und Seiten mit Zeichnungen sind ausgenommen. Alte Fassungen bleiben im Verlauf, Regeln laufen dabei nicht.'],
  ['privat', 'Bereich Privat einbeziehen', 'Sonst sieht das KI-Programm nur den Bereich Arbeit.'],
]

function McpSection() {
  const [rights, setRights] = useState(null)
  const [exe, setExe] = useState('')
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    loadMcp().then(setRights).catch(() => {})
    mcpCommand().then(setExe).catch(() => {})
  }, [])
  if (!rights) return null
  const set = (fields) => {
    const next = { ...rights, ...fields }
    setRights(next)
    saveMcp(next).catch((e) => setMessage(`Nicht gespeichert: ${e}`))
  }
  const snippet = mcpSnippet(exe)
  const copy = () => navigator.clipboard.writeText(snippet).then(() => setCopied(true), (e) => setMessage(String(e)))
  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">KI-Programme auf Nexora zugreifen lassen (MCP)</h2>
      <p className="mb-3 text-muted">
        Programme auf diesem PC, die MCP-Server selbst starten können (z. B. Claude Desktop), dürfen dann deine Notizen und Listen nutzen. Nexora öffnet dafür keinen Netzwerkzugang. Das KI-Programm schickt, was es liest, an seinen eigenen Anbieter. Änderungen an den Rechten gelten sofort.
      </p>
      <label className="mb-3 flex items-center gap-3 font-medium">
        <input type="checkbox" checked={rights.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="size-4 accent-[var(--accent)]" />
        Zugriff erlauben
      </label>
      <fieldset disabled={!rights.enabled} className={`mb-4 flex flex-col gap-3 ${rights.enabled ? '' : 'opacity-50'}`}>
        <legend className="sr-only">Rechte</legend>
        {MCP_OPTIONS.map(([id, label, hint]) => (
          <label key={id} className="flex items-start gap-3">
            <input type="checkbox" checked={!!rights[id]} onChange={(e) => set({ [id]: e.target.checked })} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
            <span>{label}<span className="block text-sm text-muted">{hint}</span></span>
          </label>
        ))}
      </fieldset>
      <h3 className="mb-1 font-medium">Im KI-Programm eintragen</h3>
      <p className="mb-2 text-sm text-muted">So oder ähnlich in dessen MCP-Einstellungen (bei Claude Desktop in der claude_desktop_config.json). Der Pfad ändert sich, falls du Nexora woanders installierst. Eine offene Seite zeigt Änderungen eines KI-Programms erst, wenn du sie neu öffnest.</p>
      <div className="relative">
        <pre className="overflow-x-auto rounded-md bg-[var(--code-bg)] px-3 py-2 pr-24 font-mono text-sm">{snippet}</pre>
        <button onClick={copy} className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-line bg-raised px-2 py-0.5 text-sm hover:border-faint">
          {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />} {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
      {message && <p role="alert" className="mt-2 text-danger">{message}</p>}
    </section>
  )
}

export default function AiSettings() {
  return (
    <>
      <ProvidersSection />
      <McpSection />
    </>
  )
}
