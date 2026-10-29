# Wandelt eine Office-Datei für die Vorschau in PDF um: unsichtbar, nur lesend, Makros abgeschaltet.
# NEXORA_SRC: Quelldatei, NEXORA_PDF: Ziel, NEXORA_DONE: Merkdatei, sobald das PDF steht
# (Office beendet sich danach im Hintergrund; Excel braucht dafür manchmal eine Minute).
# NEXORA_PID: hier steht die Prozess-ID, falls dieses Skript Office selbst gestartet hat; nur die darf Nexora
# bei einem Hänger beenden. Lief Office schon (z. B. PowerPoint, das sich anhängt), wird es nicht beendet.
$ErrorActionPreference = 'Stop'
$src = $env:NEXORA_SRC
$pdf = $env:NEXORA_PDF
$ext = [IO.Path]::GetExtension($src).ToLower()
$forceDisable = 3 # msoAutomationSecurityForceDisable: keine Makros
$app = $null
$own = $false

function Start-Office($progId, $process) {
    $before = @(Get-Process $process -ErrorAction SilentlyContinue | ForEach-Object Id)
    $a = New-Object -ComObject $progId
    $new = Get-Process $process -ErrorAction SilentlyContinue | Where-Object { $_.Id -notin $before } | Select-Object -First 1
    if ($new) {
        [IO.File]::WriteAllText($env:NEXORA_PID, [string]$new.Id)
        $script:own = $true
    }
    $a
}

try {
    if ($ext -in '.doc', '.docx', '.docm', '.rtf', '.odt') {
        $app = Start-Office 'Word.Application' 'WINWORD'
        $app.DisplayAlerts = 0
        $app.AutomationSecurity = $forceDisable
        $m = [Type]::Missing
        # nur lesen, ohne Konvertierungsfrage, leeres Kennwort statt Rückfrage, unsichtbar
        $doc = $app.Documents.Open($src, $false, $true, $false, '', '', $true, '', '', $m, $m, $false)
        $doc.ExportAsFixedFormat($pdf, 17) # wdExportFormatPDF
        $doc.Close(0)
    } elseif ($ext -in '.xls', '.xlsx', '.xlsm', '.ods') {
        $app = Start-Office 'Excel.Application' 'EXCEL'
        $app.DisplayAlerts = $false
        $app.AutomationSecurity = $forceDisable
        $book = $app.Workbooks.Open($src, 0, $true) # keine Verknüpfungen aktualisieren, nur lesen
        $book.ExportAsFixedFormat(0, $pdf) # xlTypePDF
        $book.Close($false)
    } elseif ($ext -in '.ppt', '.pptx', '.pptm', '.odp') {
        $app = Start-Office 'PowerPoint.Application' 'POWERPNT'
        $app.AutomationSecurity = $forceDisable
        $show = $app.Presentations.Open($src, -1, 0, 0) # nur lesen, ohne Fenster
        $show.SaveAs($pdf, 32) # ppSaveAsPDF
        $show.Close()
    } else {
        throw "Dateityp $ext wird nicht umgewandelt"
    }
    [IO.File]::WriteAllText($env:NEXORA_DONE, 'fertig')
} finally {
    if ($app -and $own) { $app.Quit() }
    if ($app) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
}
