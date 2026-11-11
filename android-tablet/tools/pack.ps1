param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [Parameter(Mandatory = $true)][string]$Dex,
    [Parameter(Mandatory = $true)][string]$Assets
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

$apkPath = (Resolve-Path $Apk).Path
$dexPath = (Resolve-Path $Dex).Path
$assetRoot = (Resolve-Path $Assets).Path.TrimEnd('\')

$zip = [System.IO.Compression.ZipFile]::Open($apkPath, 'Update')
try {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $dexPath, 'classes.dex',
        [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null

    Get-ChildItem -Path $assetRoot -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($assetRoot.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $_.FullName, "assets/$relative",
            [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
}
finally {
    $zip.Dispose()
}
