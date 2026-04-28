# Graph Report - /Users/jstottlemyer/Projects/AuthTools  (2026-04-27)

## Corpus Check
- 240 files · ~209,820 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 771 nodes · 1597 edges · 51 communities detected
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 96 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]

## God Nodes (most connected - your core abstractions)
1. `googleworkspace/cli (gws)` - 62 edges
2. `Docs landing (index.md)` - 55 edges
3. `GW Spec` - 50 edges
4. `GW Plan` - 33 edges
5. `runOrchestrator()` - 27 edges
6. `Concierge README` - 26 edges
7. `.mcpb Claude Desktop Extension` - 21 edges
8. `OAuth 2.0 flow` - 19 edges
9. `User onboarding (prose)` - 17 edges
10. `GW PRD Review` - 17 edges

## Surprising Connections (you probably didn't know these)
- `inspectExistingLock()` --calls--> `now()`  [INFERRED]
  /Users/jstottlemyer/Projects/AuthTools/packages/setup/src/lock.ts → packages/google-workspace/src/auth/granted-bundles.ts
- `main()` --calls--> `resolveUnpackedDistIndexJsPath()`  [INFERRED]
  packages/google-workspace/src/index.ts → /Users/jstottlemyer/Projects/AuthTools/packages/setup/src/paths.ts
- `main()` --calls--> `resolveAssetsDir()`  [INFERRED]
  packages/google-workspace/src/index.ts → /Users/jstottlemyer/Projects/AuthTools/packages/setup/src/paths.ts
- `runInstallSteps()` --calls--> `now()`  [INFERRED]
  /Users/jstottlemyer/Projects/AuthTools/packages/setup/src/phases/install.ts → packages/google-workspace/src/auth/granted-bundles.ts
- `timed()` --calls--> `now()`  [INFERRED]
  /Users/jstottlemyer/Projects/AuthTools/packages/setup/src/phases/probe.ts → packages/google-workspace/src/auth/granted-bundles.ts

## Hyperedges (group relationships)
- **OAuth first-run consent flow** — concept_oauth, concept_gws_cli, concept_client_secret, concept_project_id, concept_auto_consent, concept_progress_notif, concept_macos_keychain [EXTRACTED 0.95]
- **4-layer prompt-injection defense** — concept_prompt_injection, concept_tool_approval, concept_confirmation_phrase, concept_injection_spike, concept_log_redactor [EXTRACTED 0.95]
- **CI sign+notarize pipeline** — concept_package_mcpb_yml, concept_sign_notarize_sh, concept_temp_keychain, concept_p12_cert, concept_notary_api_key, concept_developer_id, concept_notarization, concept_slsa_attest, concept_draft_release [EXTRACTED 0.95]
- **Destructive operation confirmation flow** — concept_destructive_op, concept_confirmation_phrase, concept_remove_account, concept_factory_reset, concept_set_read_only, concept_error_code [EXTRACTED 0.95]
- **6 OAuth scope bundles** — concept_bundle_productivity, concept_bundle_collab, concept_bundle_admin, concept_bundle_education, concept_bundle_creator, concept_bundle_automation, concept_scope_bundles [EXTRACTED 1.00]
- **Cross-surface credential parity triad** — concept_cross_surface_parity, concept_gws_cli, concept_macos_keychain, concept_bundled_gws, concept_homebrew_gws, concept_client_secret [EXTRACTED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (89): GW Plan Check, Repo CLAUDE.md, 42 MCP tools (22+12+1+5+2), 48h CVE patch SLA, Local audit log (AAP-inspired), Auto-consent OAuth flow, Admin & Compliance bundle, Automation bundle (+81 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (31): invoke(), readBuildId(), readBuildTime(), readCoreVersion(), readSiblingPackageJsonVersion(), readVendorVersion(), readCallsSync(), safeParseCallRecord() (+23 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (48): buildConsentScreen(), captureConsent(), detectedLabel(), estimateMinutes(), findProbe(), upgradeLabel(), fileContainsErrorLine(), isNodeError() (+40 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (27): ensureBundleGranted(), findGrantedBundleForService(), mkCtx(), stubGrantedLookup(), stubProbe(), runBinary(), getGrantedBundlesForAccount(), listAuthenticatedAccounts() (+19 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (33): commandExists(), extractConciergeEntry(), findNewestSetupLog(), probeClaudeDesktopApp(), renderClaudeCliSection(), renderClaudeDesktopSection(), renderConciergeSection(), renderGcloudConfigSection() (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (51): googleworkspace/cli (gws), gws admin-reports activities list --help, gws admin-reports userUsageReport get --help, gws auth --help, gws auth login --help, gws auth setup --help, gws calendar --help, gws chat --help (+43 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (22): showAdminGate(), renderBanner(), resolveVersion(), writeBanner(), parseConsentInput(), showConsent(), renderFailure(), writeFailure() (+14 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (16): invokeOrchestrator(), parseAndRunDiagnose(), resolveSetupVersion(), runCli(), bufferStream(), makeHarness(), unknownFlag(), main() (+8 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (15): allDetectedProbes(), freshMachineProbes(), probe(), defaultSearchRoot(), discoverExternalProbes(), errMessage(), chooseClaudeInstaller(), defaultBinForTool() (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (18): seedAccount(), backupCorruptFile(), ensureStateDir(), isNodeError(), loadState(), normalizeEmail(), normalizeState(), readStateBytes() (+10 more)

### Community 10 - "Community 10"
Cohesion: 0.21
Nodes (21): isNodeError(), probeClaudeRegistration(), claudeMcpAdd(), claudeMcpRemove(), hardReinstallCli(), hardReinstallSequence(), isClaudeCliInstalled(), isClaudeDesktopInstalled() (+13 more)

### Community 11 - "Community 11"
Cohesion: 0.24
Nodes (20): compareSemverLt(), deriveAccountDomain(), makeVerifyPlaceholder(), parseSemverTuple(), probeApisEnabled(), probeAuthStatus(), probeBrew(), probeClaudeCli() (+12 more)

### Community 12 - "Community 12"
Cohesion: 0.26
Nodes (7): acquireLock(), inspectExistingLock(), isLockFile(), isNodeError(), isPidAlive(), readLstartEpochSec(), tryCreate()

### Community 13 - "Community 13"
Cohesion: 0.26
Nodes (9): cacheIsFresh(), checkForUpdate(), defaultCachePath(), isNewerVersion(), parseSemverish(), readCache(), stripTagPrefix(), withTimeout() (+1 more)

### Community 14 - "Community 14"
Cohesion: 0.24
Nodes (7): buildArgv(), runGwsJson(), buildCopyableCommand(), buildDocsUrl(), codeFor(), detectApiNotEnabled(), toolErrorFromGwsResult()

### Community 15 - "Community 15"
Cohesion: 0.4
Nodes (8): fail(), requireString(), validateAccountOptional(), validateArgumentNotFlag(), validateEmail(), validateMethod(), validateResource(), validateService()

### Community 16 - "Community 16"
Cohesion: 0.25
Nodes (3): FsError, normalize(), parentDir()

### Community 17 - "Community 17"
Cohesion: 0.43
Nodes (5): canonicalPhrase(), normalizeConfirmationInput(), verifyConfirmation(), baseArgumentsFor(), buildConfirmationRequiredResponse()

### Community 18 - "Community 18"
Cohesion: 0.33
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 0.83
Nodes (3): getNextAction(), getUserMessage(), interpolate()

### Community 20 - "Community 20"
Cohesion: 0.5
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 0.5
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 0.5
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (1): readCoreVersion()

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (2): exists(), isBundledState()

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **3 isolated node(s):** `Auto-consent OAuth flow`, `notifications/progress (MCP)`, `MCP session transcript fixture`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 28`** (2 nodes): `runShim()`, `claude-shim.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `runShim()`, `gws-shim.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `parseChecksums()`, `build-artifacts.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `eslint.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `user-messages.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `envelope.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `verify-mcp-server.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `mcp-server.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `build-defines.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `error.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `redact-recursion.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `redact-whitelist.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `index.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `build-defines.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `redact-whitelist.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `redact.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `now()` connect `Community 3` to `Community 1`, `Community 8`, `Community 11`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.174) - this node is a cross-community bridge._
- **Why does `runInstallSteps()` connect `Community 8` to `Community 2`, `Community 3`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `runOrchestrator()` connect `Community 2` to `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 10`, `Community 11`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Are the 18 inferred relationships involving `runOrchestrator()` (e.g. with `readEmbeddedManifest()` and `acquireLock()`) actually correct?**
  _`runOrchestrator()` has 18 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Auto-consent OAuth flow`, `notifications/progress (MCP)`, `MCP session transcript fixture` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._