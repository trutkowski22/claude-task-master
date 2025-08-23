Get-ChildItem -Path "*.js" | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $newContent = $content -replace "from '../../../scripts/modules/utils.js'", "from '../../../../scripts/modules/utils.js'"
    Set-Content $_.FullName $newContent
}