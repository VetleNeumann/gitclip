import { describe, it, expect } from 'vitest';
import { ALIAS_INSTALL, WRAPPER_BODY } from '../src/lib/profileInstall';

describe('WRAPPER_BODY', () => {
  it('refuses a clipboard that is not a GitClip script', () => {
    expect(WRAPPER_BODY).toContain("#!GITCLIP/(\\d+)");
    expect(WRAPPER_BODY).toContain('no #!GITCLIP marker');
  });

  it('anchors the marker at the start of the clipboard', () => {
    // Without \A the marker could be matched anywhere in an arbitrary
    // payload, which is the whole check the wrapper exists to make.
    expect(WRAPPER_BODY).toContain("'\\A\\s*#!GITCLIP/(\\d+)'");
  });

  it('refuses a script version it does not implement', () => {
    expect(WRAPPER_BODY).toContain('$v -ne 1');
    expect(WRAPPER_BODY).toContain('wrapper is v1');
  });
});

describe('ALIAS_INSTALL', () => {
  it('embeds the wrapper', () => {
    expect(ALIAS_INSTALL).toContain(WRAPPER_BODY);
  });

  it('creates the profile only when it does not already exist', () => {
    // `New-Item -ItemType File -Force` OVERWRITES an existing file: it
    // truncates $PROFILE to zero bytes. Unguarded, this erases whatever the
    // user (or their dotfiles manager) already had in their profile.
    const guard = ALIAS_INSTALL.indexOf('if (-not (Test-Path $PROFILE))');
    const create = ALIAS_INSTALL.indexOf('New-Item');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(guard);
  });

  it('keeps -Force on New-Item so the profile directory is created', () => {
    // -Force is still wanted: it makes the parent directory when absent.
    // Only running it against an existing file is the bug.
    expect(ALIAS_INSTALL).toContain('New-Item -Path $PROFILE -ItemType File -Force');
  });

  it('checks for an existing wrapper against the real profile contents', () => {
    // The idempotence guard has to run after the create block and see the
    // file as the user left it -- an unguarded New-Item above it would have
    // blanked the file first, so the guard could never match and the install
    // would append a duplicate on every run.
    const create = ALIAS_INSTALL.indexOf('New-Item');
    const idempotence = ALIAS_INSTALL.indexOf("Select-String -Path $PROFILE -Pattern 'function gitclip'");
    expect(idempotence).toBeGreaterThan(create);
  });

  it('appends rather than overwriting', () => {
    expect(ALIAS_INSTALL).toContain('Add-Content $PROFILE');
    expect(ALIAS_INSTALL).not.toContain('Set-Content -Path $PROFILE');
    expect(ALIAS_INSTALL).not.toContain('Out-File');
  });
});
