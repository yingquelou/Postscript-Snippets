# Generate some json files from some tag files in folder "Operators" to the folder "Snippets".
# $allname=Get-Content .\tmp.txt
$OpDir = "Operators\"
$sns = "Snippets\"
mkdir $sns
$i = 0
# $no=""
$names = (Get-ChildItem $OpDir | Select-Object -Property BaseName)
Get-ChildItem $OpDir | ForEach-Object {
    $file = $sns, $names[$i++].BaseName, ".json" -join ""
    "{" | Add-Content -Path $file -Encoding UTF8
    $its = ""
    Get-Content ($OpDir, $_ -join "") | ForEach-Object {
        $cur = $_ -split '\|'
        $label = $cur[4]
        $des = $cur[3]
        $body = ""
        $pref = $cur[2]
        # if ($allname.Contains($pref) -eq $false) {
        #   $no+= ($pref,"`n" -join "")
        # }
        $its += (",", $pref -join "")
        $j = 1
        if ($cur[1].Length) {
            -split $cur[1] | ForEach-Object {
                if ($_ -match ',') {
                    $body += ('${', $j, '|', $_, '|} ' -join "")
                }
                else {
                    $body += ('${', $j, ':', $_, '} ' -join "")
                }
                ++$j
            }
        }
        if ($j -lt 2) {
            $body = $pref
        }
        else {
            $body += $pref
        }
        @"
"$label":{
"prefix":"$pref",
"body":"$body",
"description":"pushed:$des"
},
"@
    } | Add-Content -Path $file -Encoding UTF8
    # add command index
    @"
"$($_.BaseName)":{
"prefix":"OperatorsFor$($_.BaseName)",
"body":"`${1|$($its.Substring(1))|}",
"description":"returns:$des"
}}
"@| Add-Content -Path $file -Encoding UTF8
}
# $no