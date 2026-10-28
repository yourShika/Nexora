const media = matchMedia('(prefers-color-scheme: dark)')

export function getTheme() {
  try {
    return localStorage.getItem('theme') || 'system'
  } catch {
    return 'system'
  }
}

// choice: 'system' | 'light' | 'dark'; setzt data-theme auf <html>
export function applyTheme(choice = getTheme()) {
  try {
    localStorage.setItem('theme', choice)
  } catch {}
  const dark = choice === 'dark' || (choice === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

media.addEventListener('change', () => applyTheme())
// Umschalten im Hauptfenster gilt sofort auch in der Schnellerfassung
addEventListener('storage', (e) => e.key === 'theme' && e.newValue && applyTheme(e.newValue))
