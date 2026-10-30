# Outlook-Brücke über das installierte (klassische) Outlook, COM.
# NEXORA_OP events: Termine zwischen NEXORA_FROM und NEXORA_TO lesen (Standardkalender, oder Unterkalender NEXORA_FOLDER)
# NEXORA_OP push:   JSON von stdin { create:[{key,subject,start,end,allDay,body}], update:[{id,…}], delete:[id] }
#                   nur im Unterkalender NEXORA_FOLDER; Antwort { created:{key:id}, failed:[…] }
# NEXORA_OP draft:  Mail-Entwurf { subject, body } von stdin öffnen (nie senden)
# NEXORA_OP drop:   Unterkalender NEXORA_FOLDER samt Inhalt löschen (nur für Tests)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
# stdin kommt von Nexora als UTF-8; PowerShell 5.1 liest sonst in der alten Konsolen-Codepage (ü wird zu ├╝)
[Console]::InputEncoding = New-Object Text.UTF8Encoding $false
$culture = [Globalization.CultureInfo]::InvariantCulture
$ol = $null
try {
    $ol = New-Object -ComObject Outlook.Application
    $ns = $ol.GetNamespace('MAPI')
    $calendar = $ns.GetDefaultFolder(9) # olFolderCalendar
    function Sub([bool]$create) {
        foreach ($f in $calendar.Folders) { if ($f.Name -eq $env:NEXORA_FOLDER) { return $f } }
        if ($create) { return $calendar.Folders.Add($env:NEXORA_FOLDER, 9) }
        return $null
    }
    function Fill($item, $e) {
        $item.Subject = $e.subject
        $item.AllDayEvent = [bool]$e.allDay
        $item.Start = [datetime]::Parse($e.start, $culture)
        $item.End = [datetime]::Parse($e.end, $culture)
        $item.Body = $e.body
        $item.Categories = 'Nexora' # beim Lesen überspringen, sonst doppelt
        $item.ReminderSet = $false # Nexora erinnert selbst
        $item.BusyStatus = 0 # frei: Fristen blockieren keine Zeit
        $item.Save()
    }
    switch ($env:NEXORA_OP) {
        'events' {
            $folder = if ($env:NEXORA_FOLDER) { Sub $false } else { $calendar }
            $out = New-Object Collections.ArrayList
            if ($folder) {
                $items = $folder.Items
                $items.IncludeRecurrences = $true
                $items.Sort('[Start]')
                # Farbe je Kategorie (OlCategoryColor), für die Anzeige in der Farbe der ersten Kategorie
                $catColor = @{}
                foreach ($c in $ns.Categories) { $catColor[$c.Name] = $c.Color }
                # Restrict erwartet Datumsangaben im Format der Windows-Region
                $from = [datetime]::Parse($env:NEXORA_FROM, $culture).ToString('g')
                $to = [datetime]::Parse($env:NEXORA_TO, $culture).ToString('g')
                foreach ($a in $items.Restrict("[Start] < '$to' AND [End] > '$from'")) {
                    if ($out.Count -ge 1000) { break }
                    if ($a.Categories -match '(^|;\s*)Nexora($|;)') { continue }
                    $first = @($a.Categories -split ';\s*' | Where-Object { $_ })[0]
                    $color = $null
                    if ($first) { $color = $catColor[$first] }
                    [void]$out.Add([ordered]@{
                        id = $a.GlobalAppointmentID + '/' + $a.Start.ToString('s')
                        subject = $a.Subject
                        start = $a.Start.ToString('s')
                        end = $a.End.ToString('s')
                        allDay = $a.AllDayEvent
                        location = $a.Location
                        busy = $a.BusyStatus
                        categories = $a.Categories
                        color = $color
                        entry = $a.EntryID
                    })
                }
            }
            [Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Depth 3 -Compress))
        }
        'push' {
            $job = [Console]::In.ReadToEnd() | ConvertFrom-Json
            $folder = Sub $true
            $created = @{}
            $failed = New-Object Collections.ArrayList
            foreach ($e in @($job.delete)) {
                if (-not $e) { continue }
                try { $it = $ns.GetItemFromID($e); if ($it.Parent.EntryID -eq $folder.EntryID) { $it.Delete() } } catch { }
            }
            foreach ($e in @($job.update)) {
                if (-not $e) { continue }
                try {
                    $it = $ns.GetItemFromID($e.id)
                    if ($it.Parent.EntryID -ne $folder.EntryID) { throw 'fremder Kalender' }
                    Fill $it $e
                }
                catch {
                    # Termin in Outlook gelöscht: neu anlegen
                    $it = $folder.Items.Add(1); Fill $it $e; $created[$e.key] = $it.EntryID
                }
            }
            foreach ($e in @($job.create)) {
                if (-not $e) { continue }
                try { $it = $folder.Items.Add(1); Fill $it $e; $created[$e.key] = $it.EntryID }
                catch { [void]$failed.Add($e.key + ': ' + $_.Exception.Message) }
            }
            [Console]::Out.Write((ConvertTo-Json -InputObject ([ordered]@{ created = $created; failed = @($failed) }) -Depth 3 -Compress))
        }
        'draft' {
            # Nur ein Entwurf zum Bearbeiten; gesendet wird nie von hier
            $m = [Console]::In.ReadToEnd() | ConvertFrom-Json
            $mail = $ol.CreateItem(0)
            $mail.Subject = $m.subject
            $mail.Body = $m.body
            $mail.Display()
            [Console]::Out.Write('{}')
        }
        'open' {
            # Termin in Outlook zeigen; bei Serien das Vorkommen an NEXORA_FROM. Nur anzeigen, nie ändern
            $item = $ns.GetItemFromID($env:NEXORA_ID)
            if ($item.IsRecurring) {
                try { $item = $item.GetRecurrencePattern().GetOccurrence([datetime]::Parse($env:NEXORA_FROM, $culture)) } catch { }
            }
            $insp = $item.GetInspector
            $insp.Display()
            $insp.Activate()
            [Console]::Out.Write('{}')
        }
        'drop' {
            $f = Sub $false
            if ($f) { $f.Delete() }
            [Console]::Out.Write('{}')
        }
    }
}
catch {
    [Console]::Error.Write($_.Exception.Message)
    exit 1
}
finally {
    if ($ol) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ol) }
}
