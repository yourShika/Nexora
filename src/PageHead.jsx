import { useCallback, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { ImageSquare, Smiley, Trash } from '@phosphor-icons/react'
import Menu from './Menu.jsx'
import { EmojiPicker } from './EmojiPicker.jsx'
import { assetUrl, importImage } from './images.js'

// Titelbild über die ganze Breite; nur zu sehen, wenn eins gesetzt ist
export function Cover({ node, onSave }) {
  if (!node.cover) return null
  return (
    <div className="page-cover group/cover relative h-44 w-full overflow-hidden bg-side">
      <img src={assetUrl(node.cover)} alt="" className="h-full w-full object-cover" />
      <div className={`absolute bottom-2 right-3 hidden gap-1 ${node.locked ? '' : 'group-hover/cover:flex'}`}>
        <CoverButton onClick={() => pickCover(node, onSave)}>Ändern</CoverButton>
        <CoverButton onClick={() => onSave(node.id, { cover: null })}>Entfernen</CoverButton>
      </div>
    </div>
  )
}

const CoverButton = ({ onClick, children }) => (
  <button onClick={onClick} className="rounded-md bg-raised/90 px-2 py-1 text-xs shadow-sm hover:bg-raised">{children}</button>
)

async function pickCover(node, onSave) {
  const path = await open({ title: 'Titelbild wählen', filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] })
  if (path) onSave(node.id, { cover: await importImage(path) })
}

// Symbol über dem Titel und die Knöpfe "Symbol" / "Titelbild", die bei Maus darüber erscheinen
export function IconRow({ node, onSave, onError }) {
  const [menu, setMenu] = useState(null)
  const openMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ x: r.left, y: r.bottom + 6 })
  }
  const setIcon = (icon) => (onSave(node.id, { icon }), setMenu(null))
  const closeMenu = useCallback(() => setMenu(null), [])

  // Gesperrt: Symbol nur anzeigen
  if (node.locked) return node.icon ? <div className={`${node.cover ? '-mt-10' : ''} relative mb-2 text-[44px] leading-none`}>{node.icon}</div> : null

  return (
    <div className="group/head">
      {node.icon && (
        <button onClick={openMenu} aria-label="Symbol ändern" className={`${node.cover ? '-mt-10' : ''} relative mb-2 rounded-lg text-[44px] leading-none hover:bg-hover`}>
          {node.icon}
        </button>
      )}
      <div className="flex h-7 gap-1 text-faint opacity-0 transition-opacity focus-within:opacity-100 group-hover/head:opacity-100">
        {!node.icon && (
          <button onClick={openMenu} className="flex items-center gap-1.5 rounded-md px-1.5 hover:bg-hover hover:text-text">
            <Smiley size={16} /> Symbol
          </button>
        )}
        {!node.cover && (
          <button onClick={() => pickCover(node, onSave).catch((e) => onError?.(String(e)))} className="flex items-center gap-1.5 rounded-md px-1.5 hover:bg-hover hover:text-text">
            <ImageSquare size={16} /> Titelbild
          </button>
        )}
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={closeMenu} role="dialog" label="Symbol wählen">
          <EmojiPicker onPick={setIcon} />
          {node.icon && (
            <button onClick={() => setIcon(null)} className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-hover hover:text-danger">
              <Trash size={15} /> Symbol entfernen
            </button>
          )}
        </Menu>
      )}
    </div>
  )
}
