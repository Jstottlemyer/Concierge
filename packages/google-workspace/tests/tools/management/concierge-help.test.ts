// concierge_help tests.
//
// Exercises the user-education tool that hands out common-task recipes,
// getting-started hints, troubleshooting doc links, related-tool pointers,
// and developer contact info. Invariants:
//   - Registers with `service: 'management'`, `readonly: true`.
//   - Description passes Decision #13.5 lint.
//   - Happy path returns a well-formed envelope matching the output schema.
//   - `version.vendor` / `version.core` populate from dev package.json reads.
//   - `support.developer === "Justin Stottlemyer"`.
//   - `common_tasks.length >= 10`.
//   - At least one `troubleshooting_docs` URL points at
//     `github.com/Jstottlemyer/Concierge`.
//   - `getGwsVersion()` is honored via installGwsMock so the `version.gws`
//     field populates with a realistic string.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import {
  conciergeHelp,
  ConciergeHelpOutputSchema,
} from '../../../src/tools/management/concierge-help.js';
import { validateDescription } from '../../../src/tools/mcp-schema.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';

const CTX: ToolContext = { now: '2026-04-14T00:00:00.000Z' };

let mock: InstalledGwsMock | null = null;

beforeEach(() => {
  __resetVersionCacheForTests();
});

afterEach(async () => {
  if (mock !== null) {
    await mock.uninstall();
    mock = null;
  }
  __resetVersionCacheForTests();
});

describe('concierge_help tool definition', () => {
  it('is named concierge_help, management service, readonly', () => {
    expect(conciergeHelp.name).toBe('concierge_help');
    expect(conciergeHelp.service).toBe('management');
    expect(conciergeHelp.readonly).toBe(true);
  });

  it('has an empty strict input schema', () => {
    expect(() => conciergeHelp.input.parse({})).not.toThrow();
    expect(() => conciergeHelp.input.parse({ foo: 'bar' })).toThrow();
  });

  it('description passes the Decision #13.5 lint', () => {
    const result = validateDescription(conciergeHelp.description);
    if (!result.ok) {
      throw new Error(`description-lint warnings: ${result.warnings.join('; ')}`);
    }
    expect(result.ok).toBe(true);
  });
});

describe('concierge_help invoke (happy path)', () => {
  it('returns a well-formed envelope matching ConciergeHelpOutputSchema', async () => {
    mock = await installGwsMock({
      scenarios: [
        {
          matchArgs: ['--version'],
          stdout: 'gws 1.2.3\n',
          exitCode: 0,
        },
      ],
    });

    const result = await conciergeHelp.invoke({}, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const parsed = ConciergeHelpOutputSchema.parse(result.data);

    // Welcome tagline is present and mentions Concierge.
    expect(parsed.welcome).toContain('Concierge');

    // Common tasks: >= 10 entries, each with the required shape.
    expect(parsed.common_tasks.length).toBeGreaterThanOrEqual(10);
    for (const task of parsed.common_tasks) {
      expect(typeof task.want).toBe('string');
      expect(task.want.length).toBeGreaterThan(0);
      expect(typeof task.ask_claude).toBe('string');
      expect(task.ask_claude.length).toBeGreaterThan(0);
      expect(typeof task.uses_tool).toBe('string');
      expect(task.uses_tool.length).toBeGreaterThan(0);
    }

    // Getting-started: 4-6 bullets (spec allows a range; lock to >= 4).
    expect(parsed.getting_started.length).toBeGreaterThanOrEqual(4);

    // Troubleshooting docs: at least one Concierge GH URL present.
    expect(parsed.troubleshooting_docs.length).toBeGreaterThan(0);
    const conciergeDocUrls = parsed.troubleshooting_docs.filter((d) =>
      d.url.includes('github.com/Jstottlemyer/Concierge'),
    );
    expect(conciergeDocUrls.length).toBeGreaterThan(0);

    // Related tools: pointers to concierge_info / list_accounts / etc.
    const relatedToolNames = parsed.related_tools.map((r) => r.tool);
    expect(relatedToolNames).toContain('concierge_info');

    // Support block.
    expect(parsed.support.developer).toBe('Justin Stottlemyer');
    expect(parsed.support.note.length).toBeGreaterThan(0);

    // Versions: vendor + core are non-empty (baked or dev-fallback).
    expect(parsed.version.vendor.length).toBeGreaterThan(0);
    expect(parsed.version.core.length).toBeGreaterThan(0);
    // gws was satisfied by the mock — full version line with the `gws` prefix.
    expect(parsed.version.gws).toBe('gws 1.2.3');

    // Build stamp fields — tsup-injected in bundled builds, sentinel in dev.
    expect(typeof parsed.version.build_time).toBe('string');
    expect(parsed.version.build_time.length).toBeGreaterThan(0);
    expect(
      parsed.version.build_time === 'dev-unbuilt' ||
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(parsed.version.build_time),
    ).toBe(true);
    expect(typeof parsed.version.build_id).toBe('string');
    expect(
      parsed.version.build_id === 'devbuild' || /^[0-9a-f]{8}$/.test(parsed.version.build_id),
    ).toBe(true);
  });

  it('degrades gracefully when the gws binary cannot be resolved', async () => {
    // No mock installed AND no CONCIERGE_GWS_BIN → getGwsVersion will throw,
    // but the tool should catch it and report 'unknown' rather than failing.
    const priorBin = process.env['CONCIERGE_GWS_BIN'];
    process.env['CONCIERGE_GWS_BIN'] = '/tmp/definitely-not-a-binary-xyz-concierge-help';
    try {
      const result = await conciergeHelp.invoke({}, CTX);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.data.version.gws).toBe('unknown');
      // Everything else still populates.
      expect(result.data.support.developer).toBe('Justin Stottlemyer');
      expect(result.data.common_tasks.length).toBeGreaterThanOrEqual(10);
    } finally {
      if (priorBin === undefined) delete process.env['CONCIERGE_GWS_BIN'];
      else process.env['CONCIERGE_GWS_BIN'] = priorBin;
    }
  });
});
