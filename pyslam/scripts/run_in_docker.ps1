param(
    [Parameter(Mandatory=$true, ValueFromRemainingArguments=$true)]
    [string[]]$Command
)

# Navigate to the pyslam directory to run docker-compose
$PyslamDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $PyslamDir
docker-compose up -d
Pop-Location

# Execute the command inside the seasee-r container using sh -c
$cmdStr = $Command -join " "
Write-Host "Running command inside seasee-r: $cmdStr"
docker exec -it seasee-r sh -c $cmdStr
