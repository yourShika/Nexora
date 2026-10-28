# Liest aus dem installierten OneNote (COM), schreibt nie hinein.
# NEXORA_OP: notebooks | notebook (NEXORA_ID = Notizbuch) | pages, pageinfo (NEXORA_ID = Seiten, durch ; getrennt)
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
    }
}
catch {
    [Console]::Error.Write($_.Exception.Message)
    exit 1
}
finally {
    if ($on) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($on) }
}
