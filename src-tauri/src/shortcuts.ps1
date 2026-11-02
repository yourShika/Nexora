# Icon der eigenen Nexora-Verknüpfungen setzen (Startmenü, Desktop, angeheftet). Fasst nur Verknüpfungen an, die auf dieses
# Programm zeigen. Ohne NEXORA_ICO zurück zum Icon der Programmdatei, aber nur, wenn Nexora sie vorher umgestellt hatte.
# Ausgabe: je geänderter Verknüpfung der Pfad.
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
$exe = $env:NEXORA_EXE
$ico = $env:NEXORA_ICO
$want = if ($ico) { "$ico,0" } else { "$exe,0" }
$wsh = New-Object -ComObject WScript.Shell
$pins = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned'
foreach ($root in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'), $pins)) {
  if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $root -Filter '*exora*.lnk' -Recurse -Depth 2 -File -ErrorAction SilentlyContinue) {
    try {
      $link = $wsh.CreateShortcut($file.FullName)
      if ($link.TargetPath -ine $exe) { continue }
      $ours = $link.IconLocation -like '*\icons\nexora-*'
      if (-not $ico -and -not $ours) { continue }
      if ($link.IconLocation -ieq $want) { continue }
      $link.IconLocation = $want
      $link.Save()
      $file.FullName
    } catch {
      # eine schreibgeschützte Verknüpfung soll die anderen nicht aufhalten
      continue
    }
  }
}
