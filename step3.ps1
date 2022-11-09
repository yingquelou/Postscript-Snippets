# Generate a file for vscode contributes,and you must copy it to the file "package.json".
# bug:in Snippets\Dictionary Operators.json at the snippet body "$error" -> "\\$error"
$sns = "Snippets"
$file="cbs.txt"
Get-ChildItem -Path $sns | ForEach-Object {
@"
{
"language": "postscript",
"path": "./Snippets/$($_.Name)"
},
"@
}|Set-Content $file -Encoding UTF8