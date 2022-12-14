# Generate some tag files from the file "Operators.md" to the folder "Operators".
$OpDir = 'Operators\'
mkdir $OpDir
$names = Get-Content .\name.txt
$i = 0
Get-Content .\Operators.md -Delimiter "##" -Encoding UTF8| ForEach-Object {
    $cur = $_ -split "`n"
    $len = $cur.Length
    if ($len -gt 3) {
        $cur[4..($len-3)] | Out-File ($OpDir, $names[$i], ".txt" -join "") utf8
    }
    ++$i
}