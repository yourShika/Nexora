# Liest aus dem installierten OneNote (COM); schreibt nur mit NEXORA_OP write.
# NEXORA_OP: notebooks | notebook (NEXORA_ID = Notizbuch) | pages, pageinfo (NEXORA_ID = Seiten, durch ; getrennt) | write
$ErrorActionPreference = 'Stop'
# sonst landen Fortschrittsmeldungen als CLIXML in der Fehlerausgabe
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$on = $null
try {
    $on = New-Object -ComObject OneNote.Application
    $xml = ''
    switch ($env:NEXORA_OP) {
        # 2 = hsNotebooks, 4 = hsPages; 2 = Schema 2013
        'notebooks' { $on.GetHierarchy('', 2, [ref]$xml, 2); [Console]::Out.Write($xml) }
        'notebook' { $on.GetHierarchy($env:NEXORA_ID, 4, [ref]$xml, 2); [Console]::Out.Write($xml) }
        { $_ -in 'pages', 'pageinfo' } {
            # pages mit Bilddaten (1 = piBinaryData), pageinfo ohne (0); Seiten durch ein Nullzeichen getrennt.
            # Eine inzwischen gelöschte Seite liefert leer, statt die anderen mitzureißen
            $info = if ($env:NEXORA_OP -eq 'pages') { 1 } else { 0 }
            $out = foreach ($id in $env:NEXORA_ID.Split(';')) { try { $on.GetPageContent($id, [ref]$xml, $info, 2); $xml } catch { '' } }
            [Console]::Out.Write(($out -join [char]0))
        }
        'write' {
            # Seite schreiben (nur bei Notizbüchern, für die das in Nexora eingeschaltet ist): neu anlegen
            # (NEXORA_ID = new:<Abschnitt>) oder ändern; XML aus NEXORA_FILE, Kästen in NEXORA_DELETE entfernen
            $page = $env:NEXORA_ID
            $created = $page.StartsWith('new:')
            if ($created) { $id = ''; $on.CreateNewPage($page.Substring(4), [ref]$id, 0); $page = $id }
            try {
                $content = [IO.File]::ReadAllText($env:NEXORA_FILE, [Text.Encoding]::UTF8).Replace('ID="nexora:neu"', "ID=`"$page`"")
                if ($content) { $on.UpdatePageContent($content, [DateTime]::MinValue, 2, $false) }
                foreach ($o in ($env:NEXORA_DELETE -split ';' | Where-Object { $_ })) {
                    # 0x8004200E: Kasten gibt es schon nicht mehr
                    try { $on.DeletePageContent($page, $o, [DateTime]::MinValue, $false) } catch { if ($_.Exception.Message -notmatch '8004200E') { throw } }
                }
            }
            catch {
                # keine leere Seite zurücklassen, die beim nächsten Abgleich doppelt käme
                if ($created) { try { $on.DeleteHierarchy($page, [DateTime]::MinValue, $false) } catch { } }
                throw
            }
            # gleich in die Datei: stürzt OneNote später ab, ist die Änderung sonst weg
            $on.SyncHierarchy($page)
            $on.GetPageContent($page, [ref]$xml, 0, 2)
            [Console]::Out.Write($page + [char]0 + $xml)
        }
    }
}
catch {
    [Console]::Error.Write($_.Exception.Message)
    exit 1
}
finally {
    if ($on) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($on) }
}
