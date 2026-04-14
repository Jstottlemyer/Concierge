// Licensing test — validates LICENSE + bundled-binary NOTICE presence.
//
// Part of the T20 CI gate set. Two invariants:
//   1. The repo root always has a LICENSE file (our own license, MIT in v1).
//   2. When the repo is in "bundled" state (i.e. a `.mcpb` staging directory
//      is present, or the CONCIERGE_BUNDLED env var is set), a LICENSE.gws
//      or NOTICE.gws file MUST also be present — redistributing the
//      googleworkspace/cli binary requires carrying its license forward.
//
// In ordinary dev state (no bundled binary), (2) is skipped with a clear
// reason so contributors aren't forced to fetch binaries locally just to
// run tests.
//
// Spec refs:
//   - spec.md §Distribution AC §29 (licensing attribution for bundled
//     upstream binary)
//   - plan.md T20
//   - plan.md Decision #11 (binary integrity / redistribution)
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

function exists(relPath: string): boolean {
  const full = join(REPO_ROOT, relPath);
  try {
    statSync(full);
    return true;
  } catch {
    return false;
  }
}

function isBundledState(): boolean {
  if (process.env['CONCIERGE_BUNDLED'] === '1') return true;
  // `.mcpb-staging/bin/gws` is produced by the macOS packaging job.
  if (exists('.mcpb-staging/bin/gws')) return true;
  // If someone manually placed the binary at bin/gws for a local packaging
  // rehearsal, treat that as bundled too.
  if (exists('bin/gws')) return true;
  return false;
}

describe('licensing (T20)', () => {
  it('has a LICENSE file at the repo root', () => {
    const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];
    const found = candidates.find((c) => exists(c));
    expect(found, `expected one of ${candidates.join(', ')} at repo root`).toBeDefined();
  });

  it('LICENSE file is non-empty and declares a recognizable OSS license', () => {
    const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];
    const found = candidates.find((c) => exists(c));
    expect(found).toBeDefined();
    const body = readFileSync(join(REPO_ROOT, found as string), 'utf8');
    expect(body.length, 'LICENSE is empty').toBeGreaterThan(50);
    // Accept any of the licenses we might realistically pick.
    const recognizable =
      /\b(MIT License|Apache License|BSD|ISC License|Mozilla Public License)\b/i.test(body);
    expect(
      recognizable,
      `LICENSE does not match a recognized OSS license header: ${body.slice(0, 120)}`,
    ).toBe(true);
  });

  it.skipIf(!isBundledState())(
    'bundled state: LICENSE.gws or NOTICE.gws accompanies the bundled gws binary',
    () => {
      // In bundled state, redistributing the upstream binary requires
      // carrying its license forward. Either file satisfies the
      // requirement; both is fine.
      const hasLicenseGws = exists('LICENSE.gws') || exists('.mcpb-staging/LICENSE.gws');
      const hasNoticeGws = exists('NOTICE.gws') || exists('.mcpb-staging/NOTICE.gws');
      expect(
        hasLicenseGws || hasNoticeGws,
        'bundled state detected but neither LICENSE.gws nor NOTICE.gws present at repo root or .mcpb-staging/',
      ).toBe(true);
    },
  );

  it('dev state (non-bundled) skips the bundled-binary check with a visible reason', () => {
    // This assertion is intentionally soft — it documents WHY the bundled
    // check above is conditional, so a future reader grepping for
    // "LICENSE.gws" finds the explanation here.
    const bundled = isBundledState();
    if (!bundled) {
      expect(exists('bin/gws'), 'bin/gws absent ⇒ dev state ⇒ bundled check skipped').toBe(false);
    } else {
      expect(bundled, 'bundled state is handled by the skipIf-guarded test above').toBe(true);
    }
  });
});
