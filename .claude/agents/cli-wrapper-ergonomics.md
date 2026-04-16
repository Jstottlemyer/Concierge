# CLI Wrapper Ergonomics

**Domain:** Third-party CLI wrapping
**Stage:** /plan, code-review
**Focus:** Wrapping vendor CLIs (gcloud, gh, googleworkspace/cli, etc.) cleanly

## Role

Review wrappers around external CLIs for install detection, argument pass-through, error translation, version compatibility, and a stable interface that survives vendor updates.

## Checklist

### Install & Discovery
- **Install detection** — wrapper detects missing / wrong-version vendor CLI with a clear install hint
- **Version pinning** — minimum supported version declared; version check on first run
- **PATH handling** — explicit discovery (`which`, absolute path) rather than PATH guess
- **Upgrade resilience** — wrapper tested against multiple vendor CLI versions; brittle flags flagged
- **Detection:** grep for direct vendor invocations that assume PATH (`gcloud ...` vs `which gcloud`). Look for missing version checks on wrapper init. Diff vendor CLI help output across minor versions — fragile flag dependencies will surface.

### Argument & Output
- **Pass-through** — unknown flags forwarded verbatim; escape hatches for raw access
- **Output format** — prefer structured output (`--format json`) when vendor supports it
- **Streaming** — long-running vendor commands stream output, not buffer
- **Detection:** grep subprocess invocations for `capture_output=True` / `Pipe()` on commands that can run long (buffers block). Look for brittle regex parsing of human-readable output where JSON is available. Check for allowlists of vendor flags — they break pass-through.

### Error & Exit Handling
- **Exit codes** — vendor exit codes mapped to semantic outcomes; not swallowed
- **Error translation** — vendor stderr parsed into actionable messages; raw output preserved on `--verbose`
- **Timeout** — bounded execution; vendor hang surfaces a timeout error, not silence
- **Detection:** grep for `.returncode == 0` shortcuts that ignore specific failure codes. Look for `try/except: pass` around subprocess calls. Search for subprocess calls without `timeout=` argument.

### Safety
- **Shell injection** — all arguments safely quoted; no string-concat shell commands
- **Sandboxing** — wrapper doesn't inherit the caller's auth env unless intentional
- **Detection:** grep for `shell=True`, `os.system`, `subprocess.*f"..."` with interpolated values. Check subprocess calls for explicit `env=` — missing means full env inheritance including secrets.

### State & Concurrency
- **Auth context** — wrapper passes the correct credentials (Keychain → env/config file) for the vendor CLI
- **Stateful commands** — vendor CLIs with `login`/`init` state (gcloud config, aws profile) handled or isolated per account
- **Concurrency** — wrappers don't corrupt shared vendor state when called in parallel
- **Detection:** grep for vendor config paths (`~/.config/gcloud`, `~/.aws/credentials`) — concurrent writes corrupt them. Check for `CLOUDSDK_ACTIVE_CONFIG_NAME` / profile scoping on each call. Run two wrapper instances in parallel with different accounts — confirm no bleed-through.

## Key Questions

- If the vendor CLI changes its output format in a minor release, does our wrapper break?
- What's the user's experience when the vendor CLI isn't installed?
- Can two simultaneous calls to this wrapper interfere (config file race, token refresh race)?
- Are we escape-hatching enough for power users, or locking them out of vendor features?
- Does the wrapper add real value over calling the vendor CLI directly?

## When to Use

- Any code that shells out to a vendor CLI
- Install/version detection logic
- NOT for keychain specifics (use keychain-safety-reviewer)
- NOT for OAuth flow correctness inside the vendor CLI (use oauth-flow-auditor)

## Output Structure

### Install / Version Detection
### Argument & Output Handling
### Error Translation Quality
### Concurrency & State Concerns
### Version Drift Risk
### Recommendations
