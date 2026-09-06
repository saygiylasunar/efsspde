param(
    [Parameter(Mandatory = $true)]
    [string]$ComfyRoot
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot "comfy_nodes\efsspde_nodes"

$directCustomNodes = Join-Path $ComfyRoot "custom_nodes"
$portableCustomNodes = Join-Path $ComfyRoot "ComfyUI\custom_nodes"

if (Test-Path $directCustomNodes) {
    $customNodes = $directCustomNodes
}
elseif (Test-Path $portableCustomNodes) {
    $customNodes = $portableCustomNodes
}
else {
    throw "Could not find custom_nodes under '$ComfyRoot'. Pass either the ComfyUI folder or the portable root."
}

$target = Join-Path $customNodes "efsspde_nodes"

if (Test-Path $target) {
    Remove-Item $target -Recurse -Force
}

Copy-Item $source $target -Recurse -Force
Write-Host "EFSS PDE Nodes installed to: $target"
Write-Host "Restart ComfyUI to load the node pack."
