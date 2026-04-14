// T11.5 pre-built scenario presets for the shared gws mock harness.
//
// T12 shim TDD + T30 fault injection both end up constructing the same
// handful of `GwsCallExpectation` shapes over and over: the version probe,
// `auth list`, `scopes export`, and each of the 12 shim responses. This
// module collapses that boilerplate into named helpers so tests stay
// declarative: each test authors only the scenarios unique to itself.
//
// `loadGwsResponseFixture(name)` reads from
// `tests/fixtures/gws-responses/<name>.json` — the hand-written fixture
// corpus committed in Wave 2. Returns the raw text (not parsed) because
// the `gws` CLI emits JSON on stdout and our mock passes through bytes.

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GwsCallExpectation } from './gws-mock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(here, '..', 'fixtures', 'gws-responses');

/** Read a JSON response fixture. Returns raw text. */
export function loadGwsResponseFixture(name: string): string {
  const full = path.join(FIXTURES_DIR, `${name}.json`);
  return readFileSync(full, 'utf8');
}

/**
 * `gws --version` → `gws <version>`. Mirrors the behavior of the
 * T7 fake-gws.sh default version so existing tests stay compatible.
 */
export function makeVersionScenario(version?: string): GwsCallExpectation {
  const v = version ?? '0.22.5-fake';
  return {
    matchArgs: ['--version'],
    stdout: `gws ${v}\n`,
    exitCode: 0,
  };
}

/**
 * `gws auth list` → a one-line-per-account listing. We emit one of the
 * plausible real-world formats (`<email> (default)` marker on first entry);
 * handlers are expected to tolerate either this shape or JSON output when
 * `--format json` is passed.
 */
export function makeAuthListScenario(accounts: readonly string[]): GwsCallExpectation {
  const lines = accounts.map((email, i) => (i === 0 ? `${email} (default)` : email));
  return {
    matchArgs: ['auth', 'list'],
    stdout: lines.join('\n') + '\n',
    exitCode: 0,
  };
}

/**
 * `gws scopes export --account <email>` → newline-separated scopes. The
 * real gws emits JSON under `--format json`; this preset uses the
 * human-readable default since our state-load path is the only consumer.
 */
export function makeScopesExportScenario(
  email: string,
  scopes: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: ['scopes', 'export', '--account', email],
    stdout: scopes.join('\n') + '\n',
    exitCode: 0,
  };
}

/**
 * `gws drive files list --format json` → the committed drive.files.list
 * fixture. Call sites can pass extra args through `matchArgs` if they
 * pin a page size or query.
 */
export function makeDriveFilesListScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['drive', 'files', 'list', '--format', 'json'],
    stdout: loadGwsResponseFixture('drive.files.list'),
    exitCode: 0,
  };
}

export function makeDriveFilesGetScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['drive', 'files', 'get', '--format', 'json'],
    stdout: loadGwsResponseFixture('drive.files.get'),
    exitCode: 0,
  };
}

export function makeDrivePermissionsCreateScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['drive', 'permissions', 'create', '--format', 'json'],
    stdout: loadGwsResponseFixture('drive.permissions.create'),
    exitCode: 0,
  };
}

export function makeDocsDocumentsGetScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['docs', 'documents', 'get', '--format', 'json'],
    stdout: loadGwsResponseFixture('docs.documents.get'),
    exitCode: 0,
  };
}

export function makeDocsDocumentsCreateScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['docs', 'documents', 'create', '--format', 'json'],
    stdout: loadGwsResponseFixture('docs.documents.create'),
    exitCode: 0,
  };
}

export function makeSheetsSpreadsheetsCreateScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['sheets', 'spreadsheets', 'create', '--format', 'json'],
    stdout: loadGwsResponseFixture('sheets.spreadsheets.create'),
    exitCode: 0,
  };
}

export function makeChatSpacesListScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['chat', 'spaces', 'list', '--format', 'json'],
    stdout: loadGwsResponseFixture('chat.spaces.list'),
    exitCode: 0,
  };
}

export function makeMeetSpacesCreateScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['meet', 'spaces', 'create', '--format', 'json'],
    stdout: loadGwsResponseFixture('meet.spaces.create'),
    exitCode: 0,
  };
}

export function makeFormsFormsCreateScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['forms', 'forms', 'create', '--format', 'json'],
    stdout: loadGwsResponseFixture('forms.forms.create'),
    exitCode: 0,
  };
}

export function makeFormsResponsesListScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['forms', 'forms', 'responses', 'list', '--format', 'json'],
    stdout: loadGwsResponseFixture('forms.responses.list'),
    exitCode: 0,
  };
}

export function makeAdminReportsActivitiesListScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['admin-reports', 'activities', 'list', '--format', 'json'],
    stdout: loadGwsResponseFixture('admin.reports.activities.list'),
    exitCode: 0,
  };
}

export function makeAdminReportsUsageGetScenario(
  args?: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args ?? ['admin-reports', 'userUsageReport', 'get', '--format', 'json'],
    stdout: loadGwsResponseFixture('admin.reports.usageReports.get'),
    exitCode: 0,
  };
}

/**
 * Canonical failure scenarios for T30 fault injection. Each produces the
 * exit codes + stderr shapes our `toolErrorFromGwsResult` mapper knows how
 * to translate — so T30 can assert end-to-end envelopes without repeating
 * the shell stubs.
 */
export function makeConsentDeniedScenario(
  args: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args,
    stderr: 'gws: OAuth consent denied by user\n',
    exitCode: 10,
  };
}

export function makeExpiredRefreshFailScenario(
  args: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args,
    stderr: 'gws: token expired; refresh failed (invalid_grant)\n',
    exitCode: 11,
  };
}

export function makeAccountRevokedScenario(
  args: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args,
    stderr: 'gws: account revoked; re-consent required\n',
    exitCode: 12,
  };
}

export function makeKeychainLockedScenario(
  args: readonly string[],
): GwsCallExpectation {
  return {
    matchArgs: args,
    stderr: 'gws: keychain locked; unlock and retry\n',
    exitCode: 13,
  };
}
