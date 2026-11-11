param([string]$Path, [string]$Out)
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Web
$z = [System.IO.Compression.ZipFile]::OpenRead($Path)
$e = $z.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
$r = New-Object System.IO.StreamReader($e.Open())
$x = $r.ReadToEnd()
$r.Close()
$z.Dispose()
$x = $x -replace '</w:p>', "`n"
$x = $x -replace '<w:tab[^>]*/>', "`t"
$x = $x -replace '<[^>]+>', ''
$x = [System.Web.HttpUtility]::HtmlDecode($x)
[System.IO.File]::WriteAllText($Out, $x, [System.Text.UTF8Encoding]::new($false))
Write-Output "written $Out"