/**
 * The PowerShell snippet that installs the `gitclip` wrapper into the user's
 * profile, and the wrapper itself.
 *
 * Kept out of the component so it can be asserted on directly: this is text
 * a user pastes into a shell with no undo, so its shape is a correctness
 * concern rather than a presentation one.
 */

export const WRAPPER_BODY = `function gitclip {
  $c = Get-Clipboard -Raw
  if ($c -notmatch '\\A\\s*#!GITCLIP/(\\d+)') {
    throw "gitclip: clipboard is not a GitClip script (no #!GITCLIP marker)"
  }
  $v = [int]$Matches[1]
  if ($v -ne 1) {
    throw "gitclip: script is v$v, wrapper is v1 — update the gitclip wrapper"
  }
  & ([scriptblock]::Create($c))
}`;

/**
 * `New-Item -ItemType File -Force` does not mean "create if missing" -- on an
 * existing path it overwrites, truncating the file to zero bytes. Running it
 * unconditionally against $PROFILE therefore erased whatever the user already
 * had there, and because it ran *before* the Select-String check, that check
 * could never see an existing wrapper: the guard was dead code and the
 * snippet appended a duplicate on every run.
 *
 * -Force is still correct inside the Test-Path guard, where it creates the
 * containing directory (pwsh does not ship one until the profile is first
 * written).
 */
export const ALIAS_INSTALL = `if (-not (Test-Path $PROFILE)) {
  New-Item -Path $PROFILE -ItemType File -Force | Out-Null
}
if (-not (Select-String -Path $PROFILE -Pattern 'function gitclip' -Quiet)) {
  Add-Content $PROFILE @'

${WRAPPER_BODY}
'@
}`;
