// Erwähnungen „@Name“ (LOP-060). Gespeichert bleibt reiner Text, damit Export, Obsidian und OneNote ihn so lesen;
// Nexora erkennt darin Namen aus der Personenliste, auch mit Leerzeichen (der längste passende Name gewinnt).

// Aktuelle Personen und Aktionen (setzt App bei jedem Rendern, wie setLinkData)
let data = { people: [], add: () => {}, find: () => {} }
export const setMentionData = (d) => (data = d)
export const mentionData = () => data

// Vor dem @ steht Anfang, Leerraum oder eine öffnende Klammer (nicht k.bura@firma.de);
// nach dem Namen kein Buchstabe, keine Ziffer (nicht @Buras)
export function findMentions(text, names) {
  const sorted = names.filter(Boolean).sort((a, b) => b.length - a.length)
  const out = []
  for (const m of text.matchAll(/(^|[\s([{"„“'])@/gu)) {
    const at = m.index + m[1].length
    const rest = text.slice(at + 1)
    const name = sorted.find((n) => rest.slice(0, n.length).toLowerCase() === n.toLowerCase() && !/[\p{L}\p{N}_]/u.test(rest[n.length] ?? ''))
    if (name) out.push({ from: at, to: at + 1 + name.length, name })
  }
  return out
}

// Vorschläge zu "@query": passende Namen (Anfang zuerst), dazu "Neue Person", wenn der Name noch fehlt
export function personHits(names, query, max = 8) {
  const q = query.toLowerCase()
  const hits = names
    .filter((n) => n.toLowerCase().includes(q))
    .sort((a, b) => b.toLowerCase().startsWith(q) - a.toLowerCase().startsWith(q) || a.localeCompare(b, 'de'))
    .slice(0, max)
    .map((name) => ({ name }))
  if (query && !names.some((n) => n.toLowerCase() === q)) hits.push({ name: query, isNew: true })
  return hits
}

// Text in Stücke: Adressen (http/https) als Link, bekannte @Namen als Person; Satzzeichen am Ende gehören nicht zum Link
export function textParts(text, names = []) {
  const found = [
    ...[...text.matchAll(/https?:\/\/[^\s<>"“”]+/g)].map((m) => {
      const url = m[0].replace(/[.,;:!?)\]]+$/, '')
      return { from: m.index, to: m.index + url.length, url }
    }),
    ...findMentions(text, names).map((m) => ({ from: m.from, to: m.to, person: m.name })),
  ].sort((a, b) => a.from - b.from)
  const out = []
  let at = 0
  for (const f of found) {
    if (f.from < at) continue
    if (f.from > at) out.push({ text: text.slice(at, f.from) })
    out.push({ text: text.slice(f.from, f.to), ...(f.url ? { url: f.url } : { person: f.person }) })
    at = f.to
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}
