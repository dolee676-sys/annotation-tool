# Code Signing Policy

**Project:** Zhujie Annotation (注解)  
**Repository:** https://github.com/dolee676-sys/annotation-tool  
**License:** MIT

## Scope

This policy covers the Windows release artifacts published on the project's GitHub Releases page:

https://github.com/dolee676-sys/annotation-tool/releases

## Signing provider

The project is applying to the [SignPath Foundation](https://signpath.org/) open-source code signing program. When approved, Windows release binaries will be signed by **SignPath Foundation**.

The code signing certificate is issued to SignPath Foundation, not to the project maintainer. In-app attribution such as "Made by piona" and the project's MIT license are separate from the certificate identity and remain in place.

**Current status:** the SignPath Foundation application is in progress. Until the application is approved and a signed release is published, release builds are unsigned. The release notes and SHA-256 checksum describe the current state.

## Artifacts covered

- `注解.exe`, the main executable inside `zhujie-win-x64.zip`
- `zhujie-win-x64.zip` and its `.sha256` checksum file
- The zip checksum protects transfer integrity; the Authenticode signature applies to the executable after signing

Third-party components retain their own licenses. The project does not include GPL or AGPL code copied from other projects; see the references and licenses section in the README.

## Build and release process

Windows builds are produced by GitHub Actions from the tagged commit using the repository's `Release` workflow:

https://github.com/dolee676-sys/annotation-tool/actions

The workflow runs type checking and tests, builds the app, packages the Windows files, creates `zhujie-win-x64.zip`, computes SHA-256, and publishes the release assets. The source and workflow are public.

## Verification

1. Download only from the official Releases page.
2. Verify the zip checksum:

   ```powershell
   Get-FileHash .\zhujie-win-x64.zip -Algorithm SHA256
   ```

   Compare it with the published `.sha256` file.

3. After signing is enabled, verify the executable:

   ```powershell
   Get-AuthenticodeSignature .\注解.exe
   ```

   The status should be `Valid` and the signer should be `SignPath Foundation`.

4. If the checksum or signature does not match, do not run the file. Report it through GitHub Issues:

   https://github.com/dolee676-sys/annotation-tool/issues

## Changes

This policy may be updated when the signing provider, artifacts, or verification process changes.
