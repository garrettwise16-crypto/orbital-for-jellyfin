"""Fixed elevated operations; stdin contains validated data, not PowerShell source."""
SCRIPT = r'''
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
function Get-FileHash {param([string]$LiteralPath)
 $stream=[IO.File]::OpenRead($LiteralPath)
 $digest=[Security.Cryptography.SHA256]::Create()
 try { [pscustomobject]@{Hash=([BitConverter]::ToString($digest.ComputeHash($stream))).Replace('-','')} } finally {$stream.Dispose();$digest.Dispose()}
}
$request=[Console]::In.ReadToEnd() | ConvertFrom-Json
$root=Join-Path $env:ProgramData 'OrbitalRemote'
$serviceName='OrbitalRemoteHttps'
$ruleName='OrbitalRemoteHttps-80-443'
$taskName='OrbitalRemoteAddress'
$binary=Join-Path $root 'caddy.exe'
$config=Join-Path $root 'Caddyfile'
$marker=Join-Path $root 'owner.json'
$updateScript=Join-Path $root 'UpdateAddress.ps1'
$secretFile=Join-Path $root 'address.bin'
$command='"'+$binary+'" run --config "'+$config+'" --adapter caddyfile'
$updater=@'
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
try {
 Add-Type -AssemblyName System.Security
 $bytes=[IO.File]::ReadAllBytes((Join-Path $env:ProgramData 'OrbitalRemote/address.bin'))
 $clear=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
 $settings=[Text.Encoding]::UTF8.GetString($clear) | ConvertFrom-Json
 $uri='https://www.duckdns.org/update?domains='+[Uri]::EscapeDataString($settings.domain)+'&token='+[Uri]::EscapeDataString($settings.token)+'&ip='
 $reply=Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 20
 if($reply.Content.Trim() -ne 'OK'){exit 1}
 exit 0
}catch{exit 1}
'@
$updateArguments='-NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($updater))
try {
 if ($root -ne 'C:\ProgramData\OrbitalRemote') {throw 'This preview requires the standard C: ProgramData location.'}
 $service=Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
 $owner=$null
 if(Test-Path -LiteralPath $root){
  if(!(Test-Path -LiteralPath $marker)){throw 'The HTTPS folder already exists without our ownership record. It was not changed.'}
  $owner=Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if($owner.host -ne $request.host -or $owner.upstream -ne $request.upstream){throw 'Another address or server owns this HTTPS service.'}
  if((Get-FileHash -LiteralPath $config).Hash -ne $owner.configHash -or (Get-FileHash -LiteralPath $binary).Hash -ne $owner.binaryHash){throw 'The managed files were changed outside Setup. Review them before continuing.'}
 } elseif($service){throw 'A service with this name already exists. It was not changed.'}
 if($service -and ($service.PathName -ne $command -or $service.StartName -ne 'NT AUTHORITY\LocalService')){throw 'The HTTPS service configuration changed outside Setup. It was not changed.'}
 $task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
 if($task -and (!$owner -or $task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ne "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -or $task.Actions[0].Arguments -ne $updateArguments)){throw 'An existing address-update task is not owned by this workflow.'}
 if($owner -and $owner.updateHash -and (Get-FileHash -LiteralPath $updateScript).Hash -ne $owner.updateHash){throw 'The address updater changed outside Setup. It was not changed.'}
 $rule=Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
 if($rule){
  $app=$rule | Get-NetFirewallApplicationFilter
  $ports=$rule | Get-NetFirewallPortFilter
  if(!$owner -or $app.Program -ne $binary -or (($ports.LocalPort | Sort-Object) -join ',') -ne '443,80' -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow'){throw 'An existing firewall rule differs from the one owned by Setup.'}
 }
 if($request.action -eq 'remove'){
  if(!$owner){throw 'No owned HTTPS installation was found.'}
  if($service){Stop-Service $serviceName -ErrorAction Stop; & sc.exe delete $serviceName | Out-Null; if($LASTEXITCODE){throw 'Windows could not remove the owned service.'}}
  if($rule){Remove-NetFirewallRule -Name $ruleName}
  if($task){Unregister-ScheduledTask -TaskName $taskName -Confirm:$false}
  if(Test-Path -LiteralPath $secretFile){Remove-Item -LiteralPath $secretFile}
  @{removed=$true;certificatesRetained=$true} | ConvertTo-Json -Compress
  exit 0
 }
 if(!$service){
  $listeners=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(80,443)}
  if($listeners){throw 'Ports 80 or 443 are already in use. Keep the existing proxy or choose the private connection option.'}
 }
 if(!$owner){
  New-Item -ItemType Directory -Path $root | Out-Null
  & icacls.exe $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX' | Out-Null
  if($LASTEXITCODE){throw 'Windows could not protect the HTTPS configuration folder.'}
  Copy-Item -LiteralPath $request.caddy -Destination $binary
  if((Get-FileHash -LiteralPath $binary).Hash -ne $request.caddy_sha256){throw 'Caddy changed while copying. It was not executed.'}
  [IO.File]::WriteAllText($config,$request.config,(New-Object Text.UTF8Encoding($false)))
  New-Item -ItemType Directory -Path (Join-Path $root 'data') | Out-Null
  & icacls.exe (Join-Path $root 'data') /grant:r '*S-1-5-19:(OI)(CI)M' | Out-Null
  if($LASTEXITCODE){throw 'Windows could not prepare certificate storage.'}
  $owner=[pscustomobject]@{host=$request.host;upstream=$request.upstream;configHash=(Get-FileHash -LiteralPath $config).Hash;binaryHash=(Get-FileHash -LiteralPath $binary).Hash}
  $owner | ConvertTo-Json | Set-Content -LiteralPath $marker
 }
 $validation=Start-Process -FilePath $binary -ArgumentList @('validate','--config',('"'+$config+'"'),'--adapter','caddyfile') -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root 'validate.out') -RedirectStandardError (Join-Path $root 'validate.err')
 if($validation.ExitCode){throw 'Caddy could not validate this configuration. The saved installation can be retried or removed.'}
 $dnsUpdated=$false
 if($request.dns_mode -eq 'duckdns'){
  Add-Type -AssemblyName System.Security
  if($request.dns_token){
  $secret=@{domain=$request.host.Split('.')[0];token=$request.dns_token} | ConvertTo-Json -Compress
  $encrypted=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($secret),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  [IO.File]::WriteAllBytes($secretFile,$encrypted)
  # The machine-protected secret is readable only by SYSTEM and administrators.
  & icacls.exe $secretFile /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
  if($LASTEXITCODE){throw 'Windows could not protect the address token.'}
  }elseif(!(Test-Path -LiteralPath $secretFile)){throw 'Enter your DuckDNS token to finish this step.'}
  [IO.File]::WriteAllText($updateScript,$updater,(New-Object Text.UTF8Encoding($false)))
  $owner | Add-Member -NotePropertyName updateHash -NotePropertyValue (Get-FileHash -LiteralPath $updateScript).Hash -Force
  $owner | ConvertTo-Json | Set-Content -LiteralPath $marker
  & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -EncodedCommand ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($updater)))
  if($LASTEXITCODE){throw 'DuckDNS did not accept the address update. Check your name and token and retry.'}
  $dnsUpdated=$true
  $action=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $updateArguments
  $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount
  $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
 }
 if(!$service){
  New-Service -Name $serviceName -DisplayName 'Orbital remote HTTPS' -BinaryPathName $command -StartupType Automatic -Credential (New-Object Management.Automation.PSCredential('NT AUTHORITY\LocalService',(New-Object Security.SecureString))) | Out-Null
  & sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
  if($LASTEXITCODE){throw 'Windows could not configure HTTPS service recovery.'}
 }
 if(!$rule){New-NetFirewallRule -Name $ruleName -DisplayName 'Orbital remote HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80,443 -Program $binary -Profile Any | Out-Null}
 Start-Service $serviceName
 if((Get-Service $serviceName).Status -ne 'Running'){throw 'The HTTPS service did not start. Retry to inspect its saved configuration.'}
 @{installed=$true;dns_updated=$dnsUpdated} | ConvertTo-Json -Compress
} catch {
 # Keep an owned partial installation for explicit Retry/Remove; never delete unknown files.
 [Console]::Out.Write($_.Exception.Message)
 exit 1
}
'''
