import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeTab, close, closeOthers, closeRight, cycle, move, navigate, openTab, pin, restore, serialize, show } from './tabs.js'

const views = (s) => s.tabs.map((t) => (t.pinned ? `*${t.view}` : t.view)).join(' ')
const on = (s) => activeTab(s).view

test('Reiter wie im Browser', () => {
  // alter Stand (0.27/0.28): nur angepinnte IDs; die Startseite kommt als offener Reiter dazu
  let s = restore(['a', 'b'], 'c')
  assert.equal(views(s), '*a *b c')
  assert.equal(on(s), 'c')
  assert.equal(on(restore(['a', 'b'], 'a')), 'a')
  // Klick navigiert im aktiven Reiter, schon offene Seite wird nur aktiviert
  s = navigate(s, 'd')
  assert.equal(views(s), '*a *b d')
  s = show(s, 'a')
  assert.equal(on(s), 'a')
  // aus einem angepinnten heraus: neuer Reiter rechts daneben, angepinnte bleiben vorne
  s = navigate(s, 'e')
  assert.equal(views(s), '*a *b e d')
  s = show(s, 'f', true)
  assert.equal(views(s), '*a *b e f d')
  s = openTab(s, 'today', { atEnd: true })
  assert.equal(views(s), '*a *b e f d today')
  // schließen: rechter Nachbar wird aktiv, am Ende der linke
  s = close(show(s, 'f'), activeTab(show(s, 'f')).key)
  assert.equal(on(s), 'd')
  s = close(s, s.active)
  assert.equal(on(s), 'today')
  s = close(s, s.active)
  assert.equal(on(s), 'e')
  assert.equal(views(close(s, s.tabs[0].key)), '*b e') // nicht aktiver: aktiv bleibt
  // anpinnen landet hinten bei den angepinnten, Ziehen zwischen Angepinnte pinnt
  s = openTab(s, 'g')
  s = pin(s, s.active, true)
  assert.equal(views(s), '*a *b *g e')
  s = move(s, s.tabs.find((t) => t.view === 'e').key, s.tabs[0].key, 'before')
  assert.equal(views(s), '*e *a *b *g')
  // andere / rechts davon schließen lässt Angepinnte stehen
  s = pin(s, s.tabs[0].key, false)
  s = openTab(s, 'h') // aktiv war g: h kommt direkt hinter die angepinnten
  assert.equal(views(s), '*a *b *g h e')
  const h = s.tabs.find((t) => t.view === 'h').key
  assert.equal(views(closeOthers(s, h)), '*a *b *g h')
  assert.equal(views(closeRight(s, h)), '*a *b *g h')
  // letzter Reiter zu: Heute bleibt offen
  const one = restore({ tabs: [{ view: 'x' }], active: 0 }, 'y')
  assert.equal(views(close(one, one.active)), 'today')
  // speichern und wiederherstellen
  const saved = serialize(s)
  assert.deepEqual(saved.tabs.map((t) => t.view), ['a', 'b', 'g', 'h', 'e'])
  assert.equal(on(restore(saved, 'zzz')), 'h')
  // Strg+Tab rundum
  assert.equal(on(cycle(s, 1)), 'e')
  assert.equal(on(cycle(cycle(s, 1), 1)), 'a')
  assert.equal(on(cycle(s, -1)), 'g')
})
