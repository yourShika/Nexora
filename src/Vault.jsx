import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Copy, Key, LockSimpleOpen, User, X } from '@phosphor-icons/react'
import { useApp } from './ctx.js'
import * as db from './db.js'

// Tresor über die Bitwarden-CLI (vault.rs). Hier kommen nie Passwörter an, nur Namen, Benutzer und Adressen
export const vault = {
  status: () => invoke('vault_status'),
  unlock: (password, minutes) => invoke('vault_unlock', { password, minutes }),
  lock: () => invoke('vault_lock'),
  search: (query) => invoke('vault_search', { query }),
  copy: (id, what) => invoke('vault_copy', { id, what }),
}

export const vaultMinutes = async () => Number((await db.getSetting('vault-minutes').catch(() => null)) ?? 15)

// Das /-Menü fragt über diese Funktion nach einem Eintrag; App setzt sie (öffnet Entsperren und Auswahl)
let picker = async () => null
export const setVaultPicker = (fn) => (picker = fn)
export async function pickVault(editor) {
  const item = await picker()
  if (item) editor.chain().focus().insertContent({ type: 'vaultRef', attrs: { id: item.id, name: item.name } }).run()
}

// Verweis auf einen Tresor-Eintrag: [[vault:<id>|Name]]; gespeichert werden nur ID und Name
export const VaultRef = Node.create({
  name: 'vaultRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ id: { default: null }, name: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-vault]', getAttrs: (el) => ({ id: el.dataset.vault, name: el.textContent }) }],
  renderHTML: ({ node }) => ['span', { 'data-vault': node.attrs.id }, node.attrs.name],
  markdownTokenName: 'vaultRef',
  markdownTokenizer: {
    name: 'vaultRef',
    level: 'inline',
    start: (src) => src.indexOf('[[vault:'),
    tokenize(src) {
      const m = /^\[\[vault:([0-9a-f-]{36})\|([^\]\n]*)\]\]/.exec(src)
      if (m) return { type: 'vaultRef', raw: m[0], id: m[1], name: m[2] }
    },
  },
  parseMarkdown: (token, h) => h.createNode('vaultRef', { id: token.id, name: token.name }),
  renderMarkdown: ({ attrs }) => `[[vault:${attrs.id}|${(attrs.name || 'Eintrag').replace(/[|\]\n]/g, ' ')}]]`,
  addNodeView: () => ReactNodeViewRenderer(VaultRefView),
})

function VaultRefView({ node }) {
  const app = useApp()
  const copy = (what) => app?.vaultCopy(node.attrs.id, what)
  const button = 'rounded p-0.5 text-muted hover:bg-hover hover:text-text'
  return (
    <NodeViewWrapper as="span">
      <span contentEditable={false} className="inline-flex items-center gap-0.5 rounded-md border border-line bg-raised py-px pl-1.5 pr-0.5 align-baseline text-[0.92em]">
        <Key size={13} weight="bold" className="text-accent" />
        <span className="px-1">{node.attrs.name || 'Tresor-Eintrag'}</span>
        <button title="Benutzer kopieren" aria-label="Benutzer kopieren" onClick={() => copy('benutzer')} className={button}>
          <User size={13} />
        </button>
        <button title="Passwort kopieren (wird nach 30 s gelöscht)" aria-label="Passwort kopieren" onClick={() => copy('passwort')} className={button}>
          <Copy size={13} />
        </button>
      </span>
    </NodeViewWrapper>
  )
}

function Dialog({ label, onClose, children }) {
  return (
    <div role="dialog" aria-label={label} onClick={(e) => e.target === e.currentTarget && onClose()} className="anim-fade fixed inset-0 z-50 flex justify-center bg-[rgb(10_20_22/0.4)] px-4 pt-[14vh]">
      <div className="anim-pop h-fit w-[26rem] max-w-full rounded-xl border border-line bg-raised p-5 shadow-[var(--shadow)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Key size={16} className="text-accent" /> {label}
          </h2>
          <button aria-label="Schließen" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-text">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// Master-Passwort abfragen; es geht direkt an vault.rs und wird nirgends gespeichert
export function VaultUnlock({ status, onDone }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await vault.unlock(password, await vaultMinutes())
      onDone(true)
    } catch (err) {
      setError(String(err))
      setBusy(false)
    }
  }
  return (
    <Dialog label="Tresor entsperren" onClose={() => onDone(false)}>
      <form onSubmit={submit}>
        <p className="mb-3 text-sm text-muted">
          {status?.email ? `${status.email} · ` : ''}
          {status?.server ?? 'Bitwarden'}
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Master-Passwort"
          aria-label="Master-Passwort"
          className="mb-3 w-full rounded-md border border-line bg-bg px-3 py-2 outline-none focus:border-accent"
        />
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onDone(false)} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Abbrechen</button>
          <button disabled={!password || busy} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">
            <LockSimpleOpen size={15} /> {busy ? 'Entsperrt …' : 'Entsperren'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// Eintrag suchen und wählen (für den Verweis in einer Seite)
export function VaultPicker({ onDone }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState(0)
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      vault.search(query).then((r) => alive && (setItems(r), setActive(0)), (e) => alive && setError(String(e)))
    }, 250)
    return () => ((alive = false), clearTimeout(t))
  }, [query])
  function key(e) {
    if (!items?.length) return
    if (e.key === 'ArrowDown') e.preventDefault(), setActive((active + 1) % items.length)
    if (e.key === 'ArrowUp') e.preventDefault(), setActive((active + items.length - 1) % items.length)
    if (e.key === 'Enter') e.preventDefault(), onDone(items[active])
  }
  return (
    <Dialog label="Tresor-Eintrag einfügen" onClose={() => onDone(null)}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={key}
        placeholder="Name, Benutzer oder Adresse"
        aria-label="Tresor durchsuchen"
        className="mb-2 w-full rounded-md border border-line bg-bg px-3 py-2 outline-none focus:border-accent"
      />
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !items ? (
        <p className="text-sm text-muted">Sucht …</p>
      ) : !items.length ? (
        <p className="text-sm text-muted">Nichts gefunden.</p>
      ) : (
        <ul role="listbox" className="max-h-72 overflow-y-auto">
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => onDone(it)}
                className={`flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left ${i === active ? 'bg-hover' : ''}`}
              >
                <span>{it.name}</span>
                <span className="text-xs text-muted">{[it.user, it.uri].filter(Boolean).join(' · ') || '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
