# Graph Report - .  (2026-04-18)

## Corpus Check
- Large corpus: 230 files · ~130,718 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 528 nodes · 1364 edges · 22 communities detected
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 134 edges (avg confidence: 0.8)
- Token cost: 180,000 input · 8,000 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Docs, specs & planning|Docs, specs & planning]]
- [[_COMMUNITY_Tool Types & Test Harness|Tool Types & Test Harness]]
- [[_COMMUNITY_State, Errors & Destructive Ops|State, Errors & Destructive Ops]]
- [[_COMMUNITY_MCP Server & Tool Registry|MCP Server & Tool Registry]]
- [[_COMMUNITY_gws CLI Surface & Fixtures|gws CLI Surface & Fixtures]]
- [[_COMMUNITY_OAuth Consent & Bundles|OAuth Consent & Bundles]]
- [[_COMMUNITY_Progress Notifications & Pidfile|Progress Notifications & Pidfile]]
- [[_COMMUNITY_Vendor Helper Tools|Vendor Helper Tools]]
- [[_COMMUNITY_gws Subprocess & Validators|gws Subprocess & Validators]]
- [[_COMMUNITY_concierge_info and help|concierge_info and help]]
- [[_COMMUNITY_Shim Tool Implementations|Shim Tool Implementations]]
- [[_COMMUNITY_Core Error Envelope|Core Error Envelope]]
- [[_COMMUNITY_Manifest Tests|Manifest Tests]]
- [[_COMMUNITY_Licensing Tests|Licensing Tests]]
- [[_COMMUNITY_tsup build config|tsup build config]]
- [[_COMMUNITY_Build Artifacts Tests|Build Artifacts Tests]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Core vitest config|Core vitest config]]
- [[_COMMUNITY_Core index entry|Core index entry]]
- [[_COMMUNITY_Core errors index|Core errors index]]
- [[_COMMUNITY_GW vitest config|GW vitest config]]
- [[_COMMUNITY_GW build type defs|GW build type defs]]

## God Nodes (most connected - your core abstractions)
1. `googleworkspace/cli (gws)` - 62 edges
2. `Docs landing (index.md)` - 55 edges
3. `GW Spec` - 50 edges
4. `GW Plan` - 33 edges
5. `Concierge README` - 26 edges
6. `.mcpb Claude Desktop Extension` - 21 edges
7. `OAuth 2.0 flow` - 19 edges
8. `makeError()` - 18 edges
9. `runGwsJson()` - 17 edges
10. `User onboarding (prose)` - 17 edges

## Surprising Connections (you probably didn't know these)
- `ConciergeError envelope (makeError)` --implements--> `makeError()`  [INFERRED]
  packages/core/README.md → packages/core/src/errors/envelope.ts
- `Docs landing (index.md)` --references--> `Concierge`  [EXTRACTED]
  docs/index.md → README.md
- `Docs landing (index.md)` --references--> `.mcpb Claude Desktop Extension`  [EXTRACTED]
  docs/index.md → README.md
- `Repo CLAUDE.md` --references--> `googleworkspace/cli (gws)`  [EXTRACTED]
  CLAUDE.md → README.md
- `Concierge Constitution` --references--> `googleworkspace/cli (gws)`  [EXTRACTED]
  docs/constitution.md → README.md

## Hyperedges (group relationships)
- **OAuth first-run consent flow** — concept_oauth, concept_gws_cli, concept_client_secret, concept_project_id, concept_auto_consent, concept_progress_notif, concept_macos_keychain [EXTRACTED 0.95]
- **4-layer prompt-injection defense** — concept_prompt_injection, concept_tool_approval, concept_confirmation_phrase, concept_injection_spike, concept_log_redactor [EXTRACTED 0.95]
- **CI sign+notarize pipeline** — concept_package_mcpb_yml, concept_sign_notarize_sh, concept_temp_keychain, concept_p12_cert, concept_notary_api_key, concept_developer_id, concept_notarization, concept_slsa_attest, concept_draft_release [EXTRACTED 0.95]
- **Destructive operation confirmation flow** — concept_destructive_op, concept_confirmation_phrase, concept_remove_account, concept_factory_reset, concept_set_read_only, concept_error_code [EXTRACTED 0.95]
- **6 OAuth scope bundles** — concept_bundle_productivity, concept_bundle_collab, concept_bundle_admin, concept_bundle_education, concept_bundle_creator, concept_bundle_automation, concept_scope_bundles [EXTRACTED 1.00]
- **Cross-surface credential parity triad** — concept_cross_surface_parity, concept_gws_cli, concept_macos_keychain, concept_bundled_gws, concept_homebrew_gws, concept_client_secret [EXTRACTED 0.90]

## Communities

### Community 0 - "Docs, specs & planning"
Cohesion: 0.08
Nodes (89): GW Plan Check, Repo CLAUDE.md, 42 MCP tools (22+12+1+5+2), 48h CVE patch SLA, Local audit log (AAP-inspired), Auto-consent OAuth flow, Admin & Compliance bundle, Automation bundle (+81 more)

### Community 1 - "Tool Types & Test Harness"
Cohesion: 0.07
Nodes (19): readCallsSync(), safeParseCallRecord(), loadGwsResponseFixture(), makeAdminReportsActivitiesListScenario(), makeAdminReportsUsageGetScenario(), makeChatSpacesListScenario(), makeDocsDocumentsCreateScenario(), makeDocsDocumentsGetScenario() (+11 more)

### Community 2 - "State, Errors & Destructive Ops"
Cohesion: 0.07
Nodes (37): emailDomain(), seedAccount(), invoke(), resolveSourceAccount(), isDevMode(), makeError(), bestEffortGws(), invoke() (+29 more)

### Community 3 - "MCP Server & Tool Registry"
Cohesion: 0.05
Nodes (19): dispatchToolCall(), encodeError(), encodeSuccess(), formatZodIssues(), main(), registerManagementTools(), registerPassthroughTools(), registerShimTools() (+11 more)

### Community 4 - "gws CLI Surface & Fixtures"
Cohesion: 0.08
Nodes (51): googleworkspace/cli (gws), gws admin-reports activities list --help, gws admin-reports userUsageReport get --help, gws auth --help, gws auth login --help, gws auth setup --help, gws calendar --help, gws chat --help (+43 more)

### Community 5 - "OAuth Consent & Bundles"
Cohesion: 0.08
Nodes (20): ensureBundleGranted(), findGrantedBundleForService(), mkCtx(), stubGrantedLookup(), stubProbe(), runBinary(), getGrantedBundlesForAccount(), listAuthenticatedAccounts() (+12 more)

### Community 6 - "Progress Notifications & Pidfile"
Cohesion: 0.12
Nodes (12): authInProgressProbe(), defaultAuthInProgressProbe(), findGwsAuthProcess(), isProcessAlive(), lockfilePresent(), readPidfile(), resolveConfigDirForProbe(), runPsListing() (+4 more)

### Community 7 - "Vendor Helper Tools"
Cohesion: 0.14
Nodes (2): invokeVendorHelper(), outputSchemaFailure()

### Community 8 - "gws Subprocess & Validators"
Cohesion: 0.19
Nodes (16): buildCopyableCommand(), buildDocsUrl(), codeFor(), detectApiNotEnabled(), toolErrorFromGwsResult(), buildPassthroughArgv(), invoke(), validateExtraParams() (+8 more)

### Community 9 - "concierge_info and help"
Cohesion: 0.2
Nodes (15): invoke(), readBuildId(), readBuildTime(), readCoreVersion(), readSiblingPackageJsonVersion(), readVendorVersion(), getGwsBinaryFacts(), hashFileSha256() (+7 more)

### Community 10 - "Shim Tool Implementations"
Cohesion: 0.26
Nodes (16): invoke(), invoke(), invoke(), buildArgv(), mergeParams(), runGwsJson(), invoke(), invoke() (+8 more)

### Community 11 - "Core Error Envelope"
Cohesion: 0.31
Nodes (4): ConciergeError, getNextAction(), getUserMessage(), interpolate()

### Community 12 - "Manifest Tests"
Cohesion: 0.67
Nodes (0): 

### Community 13 - "Licensing Tests"
Cohesion: 1.0
Nodes (2): exists(), isBundledState()

### Community 14 - "tsup build config"
Cohesion: 1.0
Nodes (0): 

### Community 15 - "Build Artifacts Tests"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "ESLint Config"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Core vitest config"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Core index entry"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Core errors index"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "GW vitest config"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "GW build type defs"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **3 isolated node(s):** `Auto-consent OAuth flow`, `notifications/progress (MCP)`, `MCP session transcript fixture`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `tsup build config`** (2 nodes): `tsup.config.ts`, `readCoreVersion()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Build Artifacts Tests`** (2 nodes): `parseChecksums()`, `build-artifacts.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ESLint Config`** (1 nodes): `eslint.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Core vitest config`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Core index entry`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Core errors index`** (1 nodes): `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `GW vitest config`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `GW build type defs`** (1 nodes): `build-defines.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `makeError()` connect `State, Errors & Destructive Ops` to `Docs, specs & planning`, `MCP Server & Tool Registry`, `OAuth Consent & Bundles`, `Vendor Helper Tools`, `gws Subprocess & Validators`, `Shim Tool Implementations`?**
  _High betweenness centrality (0.427) - this node is a cross-community bridge._
- **Why does `ConciergeError envelope (makeError)` connect `Docs, specs & planning` to `State, Errors & Destructive Ops`?**
  _High betweenness centrality (0.377) - this node is a cross-community bridge._
- **Why does `googleworkspace/cli (gws)` connect `gws CLI Surface & Fixtures` to `Docs, specs & planning`?**
  _High betweenness centrality (0.173) - this node is a cross-community bridge._
- **What connects `Auto-consent OAuth flow`, `notifications/progress (MCP)`, `MCP session transcript fixture` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Docs, specs & planning` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Tool Types & Test Harness` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `State, Errors & Destructive Ops` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._