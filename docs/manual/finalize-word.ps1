# 생성된 매뉴얼을 Microsoft Word 로 열어 목차(TOC)를 채우고 저장한다. (Windows + Word 필요)
#   powershell -ExecutionPolicy Bypass -File docs/manual/finalize-word.ps1 [-Pdf <pdf 경로>]
param([string]$Pdf = "")

$docx = Join-Path $PSScriptRoot 'COD-SEARCHGRID-Manual-ko.docx'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
    $doc = $word.Documents.Open($docx)
    foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
    $doc.Fields.Update() | Out-Null
    $doc.Save()
    if ($Pdf) { $doc.ExportAsFixedFormat($Pdf, 17) }   # 17 = wdExportFormatPDF
    "pages: " + $doc.ComputeStatistics(2)               # 2 = wdStatisticPages
    $doc.Close()
} finally {
    $word.Quit()
}
