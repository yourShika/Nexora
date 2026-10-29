// Reiter wie im Browser. Zustand: { tabs: [{ key, view, pinned }], active: key }.
// view ist eine Seiten-ID oder eine feste Ansicht ('today', 'inbox', …); angepinnte stehen immer vorne.
// Alles hier ist rein (gibt einen neuen Zustand zurück), App.jsx speichert und zeigt.
const tab = (view, pinned = false) => ({ key: Math.random().toString(36).slice(2, 10), view, pinned })
const order = (tabs) => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]
// mindestens ein Reiter, und der aktive existiert
function fix(s) {
  const tabs = order(s.tabs.length ? s.tabs : [tab('today')])
  return { tabs, active: tabs.some((t) => t.key === s.active) ? s.active : tabs.at(-1).key }
}

export const activeTab = (s) => s.tabs.find((t) => t.key === s.active)

// gespeichert als { tabs: [{ view, pinned }], active: Index }; bis 0.28 war es nur die Liste der angepinnten IDs
export function restore(saved, start) {
  if (saved?.tabs?.length) {
    const tabs = saved.tabs.map((t) => tab(t.view, !!t.pinned))
    return fix({ tabs, active: tabs[saved.active]?.key })
  }
  const tabs = (Array.isArray(saved) ? saved : []).map((id) => tab(id, true))
  const there = tabs.find((t) => t.view === start)
  if (!there) tabs.push(tab(start))
  return fix({ tabs, active: (there ?? tabs.at(-1)).key })
}

export const serialize = (s) => ({ tabs: s.tabs.map(({ view, pinned }) => ({ view, pinned })), active: s.tabs.findIndex((t) => t.key === s.active) })

// neuer Reiter rechts neben dem aktiven (wie im Browser), mit atEnd ganz hinten
export function openTab(s, view, { pinned = false, atEnd = false } = {}) {
  const t = tab(view, pinned)
  const tabs = [...s.tabs]
  tabs.splice(atEnd ? tabs.length : tabs.findIndex((x) => x.key === s.active) + 1, 0, t)
  return fix({ tabs, active: t.key })
}

// im aktiven Reiter zeigen; ein angepinnter bleibt bei seiner Seite, dann gibt es einen neuen Reiter
export function navigate(s, view) {
  const a = activeTab(s)
  if (!a) return openTab(s, view)
  if (a.view === view) return s
  if (a.pinned) return openTab(s, view)
  return { ...s, tabs: s.tabs.map((t) => (t.key === a.key ? { ...t, view } : t)) }
}

// aus Seitenleiste, Suche, Links: ist die Seite schon in einem Reiter, dorthin wechseln
export function show(s, view, newTab = false) {
  const there = s.tabs.find((t) => t.view === view)
  if (there) return there.key === s.active ? s : { ...s, active: there.key }
  return newTab ? openTab(s, view) : navigate(s, view)
}

// schließen; aktiv wird der rechte Nachbar, sonst der linke
export function close(s, key) {
  const i = s.tabs.findIndex((t) => t.key === key)
  if (i < 0) return s
  const tabs = s.tabs.filter((t) => t.key !== key)
  return fix({ tabs, active: s.active !== key ? s.active : (tabs[i] ?? tabs[i - 1])?.key })
}

// angepinnte bleiben stehen, wie im Browser
export const closeOthers = (s, key) => fix({ tabs: s.tabs.filter((t) => t.pinned || t.key === key), active: key })
export function closeRight(s, key) {
  const i = s.tabs.findIndex((t) => t.key === key)
  const tabs = s.tabs.filter((t, j) => j <= i || t.pinned)
  return fix({ tabs, active: tabs.some((t) => t.key === s.active) ? s.active : key })
}

export const pin = (s, key, pinned) => fix({ ...s, tabs: s.tabs.map((t) => (t.key === key ? { ...t, pinned } : t)) })

// ziehen: vor oder hinter einen anderen Reiter; zwischen Angepinnte gezogen wird er selbst angepinnt
export function move(s, key, target, side) {
  const t = s.tabs.find((x) => x.key === key)
  const to = s.tabs.find((x) => x.key === target)
  if (!t || !to || key === target) return s
  const rest = s.tabs.filter((x) => x.key !== key)
  rest.splice(rest.indexOf(to) + (side === 'after' ? 1 : 0), 0, { ...t, pinned: to.pinned })
  return fix({ ...s, tabs: rest })
}

// Strg+Tab: nur durch die gerade sichtbaren Reiter (der Bereich blendet andere aus)
export function cycle(s, dir, visible = s.tabs) {
  const i = visible.findIndex((t) => t.key === s.active)
  const next = visible[(i + dir + visible.length) % visible.length]
  return next ? { ...s, active: next.key } : s
}
