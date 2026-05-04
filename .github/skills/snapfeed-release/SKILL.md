---
name: snapfeed-release
description: "Runs the Snapfeed npm release flow: bump versions, push to main, and trigger the ESRP release pipeline in Azure DevOps. Use whenever the user asks to release, publish, ship a new version, bump+release, trigger ESRP, kick off the release pipeline, or run the npm release."
---

# Snapfeed Release

## Overview

Snapfeed publishes `@microsoft/snapfeed` and `@microsoft/snapfeed-server` to npm via an Azure DevOps ESRP pipeline (signed publish). The flow is:

1. Land changes on `main` (PR merged).
2. Bump versions in `packages/client/package.json` and `packages/server/package.json`.
3. Commit and push to `main` with the conventional message.
4. Trigger the ESRP pipeline in ADO against `main`.
5. Verify the run completed successfully.

The GitHub Actions `publish.yml` workflow in this repo is intentionally disabled (`if: false`); the canonical release path is the ADO pipeline below.

## Constants

- **ADO organization:** `msdata` (`https://msdata.visualstudio.com`)
- **ADO project:** `A365`
- **Pipeline definition ID:** `55290`
- **Pipeline URL:** `https://msdata.visualstudio.com/A365/_build?definitionId=55290`
- **Release branch:** `main`
- **Packages:** `@microsoft/snapfeed`, `@microsoft/snapfeed-server`
- **Bump script:** `scripts/bump-version.mjs` (bumps both packages in lockstep)

## When to Use

Use this skill when the user asks for any of the following:

- Release / publish / ship a new version
- Bump version and release
- Trigger the ESRP pipeline
- Kick off the release pipeline
- Run the npm release
- Cut a new Snapfeed release

## Versioning Convention

Snapfeed is pre-1.0. Pick the bump level from the merged changes since the last release:

- **Patch** (`0.1.1` → `0.1.2`): bug fixes, internal cleanups, no API changes.
- **Minor** (`0.1.1` → `0.2.0`): new features **or** breaking API changes (pre-1.0 convention — breaking changes do not require a major bump while major is still 0).
- **Major** (`0.1.1` → `1.0.0`): only when explicitly graduating to a stable 1.x line.

If unclear, ask the user which level to bump.

## Procedure

### 1. Verify prerequisites

```powershell
cd <repo-root>
git checkout main
git pull origin main
git status              # must be clean
git log --oneline -5    # confirm the changes you expect are on main
```

If the user just merged a PR, confirm the merge commit is in this log before bumping.

### 2. Bump versions

Use the existing script — do **not** edit `package.json` files by hand. The script keeps both packages in lockstep.

```powershell
node scripts/bump-version.mjs <new-version>
# e.g. node scripts/bump-version.mjs 0.2.0
```

The script validates semver, updates both `packages/client/package.json` and `packages/server/package.json`, and prints the old → new version per package.

### 3. Commit and push

Follow the existing commit message convention used by previous release commits on `main`:

```
chore: bump version to <new-version> for ESRP release
```

```powershell
git add packages/client/package.json packages/server/package.json
git commit -m "chore: bump version to <new-version> for ESRP release

<one-line summary of what's in this release, optionally with a short
list of breaking changes if applicable>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin main
```

If branch protection blocks direct push to `main`, open a tiny version-bump PR instead and merge it before triggering the pipeline.

### 4. Trigger the ESRP pipeline

The pipeline does **not** auto-trigger on the version-bump commit — it must be queued explicitly.

**Preferred: Azure CLI**

```powershell
# One-time setup if not already done:
az login
az extension add --name azure-devops
az devops configure --defaults organization=https://msdata.visualstudio.com project=A365

# Queue a run against the latest main:
az pipelines run --id 55290 --branch main
```

The command prints the run ID, status, and URL. Note the run ID for verification.

**Fallback: ADO REST API**

```powershell
$pat = $env:AZURE_DEVOPS_PAT  # PAT with Build (Read & execute) scope
$headers = @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pat")))" }
$body = @{ resources = @{ repositories = @{ self = @{ refName = "refs/heads/main" } } } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post `
  -Uri "https://dev.azure.com/msdata/A365/_apis/pipelines/55290/runs?api-version=7.1" `
  -Headers $headers -ContentType "application/json" -Body $body
```

**Fallback: Web UI**

Open `https://msdata.visualstudio.com/A365/_build?definitionId=55290` → **Run pipeline** → Branch: `main` → **Run**.

### 5. Verify

- Watch the run on the pipeline URL until it reaches a terminal state.
- After success, confirm both packages are visible on npm at the new version:

```powershell
npm view @microsoft/snapfeed version
npm view @microsoft/snapfeed-server version
```

Report the run URL and the npm versions back to the user.

## Strong Preferences

- Always use `scripts/bump-version.mjs` to bump versions; never edit `package.json` versions by hand.
- Always bump both packages to the same version.
- Always trigger the pipeline against `main`, never against a feature branch — ESRP signing requires it.
- Always verify the pipeline run reached success before declaring the release done.

## Avoid

- Editing `package.json` versions manually (risks lockstep drift).
- Triggering the pipeline before the version-bump commit lands on `main`.
- Triggering the GitHub Actions `publish.yml` workflow — it is disabled and not the canonical release path.
- Skipping the verification step.

## Output Expectations

When using this skill:

- Confirm the bump level and new version (ask the user if unclear).
- Show the bump script output and the pushed commit SHA.
- Show the queued pipeline run ID and URL.
- After the run completes, show the npm-published versions for both packages.
