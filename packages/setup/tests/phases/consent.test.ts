// Tests for C2: phases/consent.ts.
//
// The consent phase is a pure reducer over ProbeResult[] plus an injected
// prompt seam, so we don't need filesystem fixtures, subprocess shims, or
// memfs here — just fabricated probe arrays. This is the deliberate
// "MIGRATION_RULES table is the SUT" design from plan D5: every rule gets
// exercised in isolation against a synthetic probe set.

import { describe, expect, it, vi } from 'vitest';

import {
  MIGRATION_RULES,
  buildConsentScreen,
  captureConsent,
  type ConsentScreen,
} from '../../src/phases/consent.js';
import type {
  ApisEnabledDetail,
  AuthStatusDetail,
  BrewDetail,
  ClaudeCliDetail,
  ClaudeDesktopDetail,
  ClientSecretDetail,
  GcloudAppDefaultDetail,
  GcloudDetail,
  GwsDetail,
  GwsVersionDetail,
  McpbDesktopDetail,
  NodeDetail,
  ProbeName,
  ProbeResult,
  ProbeStatus,
} from '../../src/types/probe.js';

// ---------------------------------------------------------------------------
// Fixture helpers — keep tests readable, never silently default an unrelated
// probe (caller must explicitly opt in to each).
// ---------------------------------------------------------------------------

const ISO = '2026-04-25T12:00:00.000Z';

function probe<T>(
  name: ProbeName,
  status: ProbeStatus,
  detail?: T,
): ProbeResult<T> {
  return {
    name,
    status,
    ...(detail !== undefined ? { detail } : {}),
    durationMs: 0,
    timestamp: ISO,
  };
}

/** Minimal "everything detected, nothing to do" probe set. */
function allDetectedProbes(): ProbeResult[] {
  return [
    probe<BrewDetail>('brew', 'ok', { version: '4.2.0' }),
    probe<NodeDetail>('node', 'ok', { version: 'v20.10.0', major: 20 }),
    probe<GwsDetail>('gws', 'ok', { version: '0.22.5', absPath: '/opt/homebrew/bin/gws' }),
    probe<GwsVersionDetail>('gws.version', 'ok', {
      installed: '0.22.5',
      required: '0.22.5',
      needsUpgrade: false,
    }),
    probe<GcloudDetail>('gcloud', 'ok', { version: '460.0.0' }),
    probe<GcloudAppDefaultDetail>('gcloud.appDefault', 'ok', {
      hasToken: true,
    }),
    probe<ClaudeCliDetail>('claude.cli', 'ok', {
      version: '0.5.0',
      absPath: '/opt/homebrew/bin/claude',
    }),
    probe<ClaudeDesktopDetail>('claude.desktop', 'ok', {
      absPath: '/Applications/Claude.app',
      appPath: '/Applications',
    }),
    probe<ClientSecretDetail>('gws.clientSecret', 'ok', {
      path: '/Users/test/.config/gws/client_secret.json',
      projectId: 'desktop-app-493302',
      placeholderSuspect: false,
      clientIdNumericPrefix: '493302',
    }),
    probe<AuthStatusDetail>('gws.authStatus', 'ok', {
      user: 'test@example.com',
      tokenValid: true,
      projectId: 'desktop-app-493302',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    }),
    probe<ApisEnabledDetail>('gcp.apisEnabled', 'ok', {
      project: 'desktop-app-493302',
      enabled: ['gmail'],
      missing: [],
    }),
  ];
}

/** Fresh-machine: nothing detected. */
function freshMachineProbes(): ProbeResult[] {
  return [
    probe<BrewDetail>('brew', 'missing'),
    probe<NodeDetail>('node', 'missing'),
    probe<GwsDetail>('gws', 'missing'),
    probe<GcloudDetail>('gcloud', 'missing'),
    probe<ClaudeCliDetail>('claude.cli', 'missing'),
    probe<ClaudeDesktopDetail>('claude.desktop', 'missing'),
    probe<ClientSecretDetail>('gws.clientSecret', 'missing'),
    probe<AuthStatusDetail>('gws.authStatus', 'missing'),
  ];
}

// ---------------------------------------------------------------------------
// captureConsent — auto-approval / prompt routing
// ---------------------------------------------------------------------------

describe('captureConsent: auto-approval', () => {
  it('auto-approves when nothing to install AND no prior install AND no pause-with-fix', async () => {
    const promptFn = vi.fn(async () => true);

    const decision = await captureConsent(allDetectedProbes(), {
      prompt: promptFn,
    });

    expect(decision.autoApproved).toBe(true);
    expect(decision.approved).toBe(true);
    expect(promptFn).not.toHaveBeenCalled();
    expect(decision.migrations).toEqual([]);
  });

  it('does NOT auto-approve when a pause-with-fix migration matches, even with empty install list', async () => {
    // All tools detected, but client_secret has a placeholder project_id —
    // the user must address that before we can proceed.
    const probes = [
      ...allDetectedProbes().filter((p) => p.name !== 'gws.clientSecret'),
      probe<ClientSecretDetail>('gws.clientSecret', 'ok', {
        path: '/Users/test/.config/gws/client_secret.json',
        projectId: 'authtools-spike',
        placeholderSuspect: true,
        clientIdNumericPrefix: '493302',
      }),
    ];
    const promptFn = vi.fn(async () => true);

    const decision = await captureConsent(probes, { prompt: promptFn });

    expect(decision.autoApproved).toBe(false);
    expect(promptFn).toHaveBeenCalledTimes(1);
    expect(
      decision.migrations.find((m) => m.ruleId === 'placeholder-project-id'),
    ).toBeDefined();
  });
});

describe('captureConsent: fresh machine', () => {
  it('shows the consent screen and approves on yes', async () => {
    const promptFn = vi.fn(async (_screen: ConsentScreen) => true);

    const decision = await captureConsent(freshMachineProbes(), {
      prompt: promptFn,
    });

    expect(promptFn).toHaveBeenCalledTimes(1);
    const screen = promptFn.mock.calls[0]![0];
    // brew, node, gws, gcloud, claude.cli, claude.desktop = 6
    expect(screen.willInstall.length).toBeGreaterThanOrEqual(5);
    expect(decision.approved).toBe(true);
    expect(decision.autoApproved).toBe(false);
  });

  it('records refusal when user says no', async () => {
    const promptFn = vi.fn(async () => false);

    const decision = await captureConsent(freshMachineProbes(), {
      prompt: promptFn,
    });

    expect(decision.approved).toBe(false);
    expect(decision.autoApproved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MIGRATION_RULES — per-rule coverage
// ---------------------------------------------------------------------------

describe('MIGRATION_RULES: v0x-extension-stale', () => {
  it('matches when mcpb.desktop is stale and surfaces a priorInstall line', async () => {
    const probes = [
      ...allDetectedProbes(),
      probe<McpbDesktopDetail>('mcpb.desktop', 'stale', {
        unpackedPath: '/Users/test/Library/Application Support/Claude/...',
        bundledSha: 'abcdef1234567890',
        installedSha: '1234567890abcdef',
        namespace: 'local.mcpb.justin-stottlemyer.concierge-google-workspace',
        matches: false,
      }),
    ];

    const screen = buildConsentScreen(probes);
    expect(
      screen.priorInstall.some((line) => line.includes('Concierge extension')),
    ).toBe(true);

    const promptFn = vi.fn(async () => true);
    const decision = await captureConsent(probes, { prompt: promptFn });
    const migration = decision.migrations.find(
      (m) => m.ruleId === 'v0x-extension-stale',
    );
    expect(migration).toBeDefined();
    expect(migration?.behavior).toBe('hard-reinstall');
  });
});

describe('MIGRATION_RULES: half-completed-no-auth', () => {
  it('matches when clientSecret is ok but authStatus missing → run-oauth', async () => {
    const probes = [
      probe<BrewDetail>('brew', 'ok', { version: '4.2.0' }),
      probe<NodeDetail>('node', 'ok', { version: 'v20.10.0', major: 20 }),
      probe<GwsDetail>('gws', 'ok', { version: '0.22.5', absPath: '/x/gws' }),
      probe<ClientSecretDetail>('gws.clientSecret', 'ok', {
        path: '/x',
        projectId: 'desktop-app-493302',
        placeholderSuspect: false,
        clientIdNumericPrefix: '493302',
      }),
      probe<AuthStatusDetail>('gws.authStatus', 'missing'),
      probe<GcloudDetail>('gcloud', 'ok', { version: '460.0.0' }),
      probe<GcloudAppDefaultDetail>('gcloud.appDefault', 'ok', { hasToken: true }),
      probe<ClaudeCliDetail>('claude.cli', 'ok', { version: '0.5.0', absPath: '/x' }),
      probe<ClaudeDesktopDetail>('claude.desktop', 'ok', {
        absPath: '/Applications/Claude.app',
        appPath: '/Applications',
      }),
    ];

    const promptFn = vi.fn(async () => true);
    const decision = await captureConsent(probes, { prompt: promptFn });
    const migration = decision.migrations.find(
      (m) => m.ruleId === 'half-completed-no-auth',
    );
    expect(migration).toBeDefined();
    expect(migration?.behavior).toBe('run-oauth');
  });
});

describe('MIGRATION_RULES: placeholder-project-id', () => {
  it('matches and supplies a non-empty fixHint pointing at recovery docs', async () => {
    const probes = [
      ...allDetectedProbes().filter((p) => p.name !== 'gws.clientSecret'),
      probe<ClientSecretDetail>('gws.clientSecret', 'ok', {
        path: '/Users/test/.config/gws/client_secret.json',
        projectId: 'authtools-spike',
        placeholderSuspect: true,
        clientIdNumericPrefix: '493302',
      }),
    ];

    const promptFn = vi.fn(async () => true);
    const decision = await captureConsent(probes, { prompt: promptFn });
    const migration = decision.migrations.find(
      (m) => m.ruleId === 'placeholder-project-id',
    );
    expect(migration).toBeDefined();
    expect(migration?.behavior).toBe('pause-with-fix');
    expect(migration?.fixHint).toBeDefined();
    expect(migration?.fixHint?.length ?? 0).toBeGreaterThan(20);
    // The hint should point at a recovery URL/doc.
    expect(migration?.fixHint).toMatch(/cloud console|client_secret|project/i);
  });
});

describe('MIGRATION_RULES: gcloud-app-default-missing', () => {
  it('matches when gcloud is ok but app-default auth missing', async () => {
    const probes = [
      ...allDetectedProbes().filter(
        (p) => p.name !== 'gcloud.appDefault',
      ),
      probe<GcloudAppDefaultDetail>('gcloud.appDefault', 'missing'),
    ];

    const promptFn = vi.fn(async () => true);
    const decision = await captureConsent(probes, { prompt: promptFn });
    const migration = decision.migrations.find(
      (m) => m.ruleId === 'gcloud-app-default-missing',
    );
    expect(migration).toBeDefined();
    expect(migration?.behavior).toBe('run-oauth');
  });
});

describe('MIGRATION_RULES: account-mismatch (placeholder for v2.0)', () => {
  it('never matches in v2.0 (no on-disk state file to compare against)', async () => {
    // Try every probe shape we can think of — none should trigger this rule.
    const promptFn = vi.fn(async () => true);
    const decision = await captureConsent(allDetectedProbes(), {
      prompt: promptFn,
    });
    expect(
      decision.migrations.find((m) => m.ruleId === 'account-mismatch'),
    ).toBeUndefined();
  });
});

describe('MIGRATION_RULES: multiple distinct rules can match together', () => {
  it('records both stale-extension AND placeholder-project-id when both are present', async () => {
    const probes = [
      ...allDetectedProbes().filter((p) => p.name !== 'gws.clientSecret'),
      probe<ClientSecretDetail>('gws.clientSecret', 'ok', {
        path: '/x',
        projectId: 'authtools-spike',
        placeholderSuspect: true,
        clientIdNumericPrefix: '493302',
      }),
      probe<McpbDesktopDetail>('mcpb.desktop', 'stale', {
        unpackedPath: '/x',
        bundledSha: 'aaaaaaa',
        installedSha: 'bbbbbbb',
        namespace: 'local.mcpb.x.y',
        matches: false,
      }),
    ];

    const promptFn = vi.fn(async () => true);
    const decision = await captureConsent(probes, { prompt: promptFn });

    const ruleIds = decision.migrations.map((m) => m.ruleId);
    expect(ruleIds).toContain('v0x-extension-stale');
    expect(ruleIds).toContain('placeholder-project-id');

    // And both lines surface in the consent screen.
    const screen = buildConsentScreen(probes);
    expect(screen.priorInstall.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// buildConsentScreen — sizing math
// ---------------------------------------------------------------------------

describe('buildConsentScreen: estimated size', () => {
  it('sums per-tool MB across multiple to-install items and picks the right ETA bucket', async () => {
    // Fresh machine: brew(50) + node(80) + gws(10) + gcloud(200)
    //   + claude.cli(80) + claude.desktop(250) = 670 MB → "5-10 min"
    const screen = buildConsentScreen(freshMachineProbes());
    expect(screen.totalSizeMb).toBe(50 + 80 + 10 + 200 + 80 + 250);
    expect(screen.estimatedMinutes).toBe('5-10 min');
    expect(screen.willInstall).toContain('Homebrew');
    expect(screen.willInstall).toContain('Node');
    expect(screen.willInstall).toContain('gws CLI');
    expect(screen.willInstall).toContain('gcloud CLI');
    expect(screen.willInstall).toContain('Claude CLI');
    expect(screen.willInstall).toContain('Claude Desktop');
  });

  it('picks the "1-2 min" bucket for sub-100MB installs', async () => {
    const probes = [
      probe<BrewDetail>('brew', 'ok', { version: '4.2.0' }),
      probe<NodeDetail>('node', 'ok', { version: 'v20.10.0', major: 20 }),
      probe<GwsDetail>('gws', 'missing'), // 10 MB
      probe<GcloudDetail>('gcloud', 'ok', { version: '460.0.0' }),
      probe<GcloudAppDefaultDetail>('gcloud.appDefault', 'ok', { hasToken: true }),
      probe<ClaudeCliDetail>('claude.cli', 'missing'), // 80 MB
      probe<ClaudeDesktopDetail>('claude.desktop', 'ok', {
        absPath: '/Applications/Claude.app',
        appPath: '/Applications',
      }),
    ];

    const screen = buildConsentScreen(probes);
    expect(screen.totalSizeMb).toBe(10 + 80);
    expect(screen.estimatedMinutes).toBe('1-2 min');
  });

  it('picks the "3-5 min" bucket for sub-300MB installs', async () => {
    const probes = [
      probe<BrewDetail>('brew', 'ok', { version: '4.2.0' }),
      probe<NodeDetail>('node', 'missing'), // 80
      probe<GwsDetail>('gws', 'missing'), // 10
      probe<GcloudDetail>('gcloud', 'missing'), // 200
      probe<ClaudeCliDetail>('claude.cli', 'ok', {
        version: '0.5.0',
        absPath: '/x',
      }),
      probe<ClaudeDesktopDetail>('claude.desktop', 'ok', {
        absPath: '/Applications/Claude.app',
        appPath: '/Applications',
      }),
    ];

    const screen = buildConsentScreen(probes);
    expect(screen.totalSizeMb).toBe(80 + 10 + 200);
    expect(screen.estimatedMinutes).toBe('3-5 min');
  });

  it('counts stale tools in willUpgrade and surfaces installed→required version arrow', async () => {
    const probes = [
      probe<BrewDetail>('brew', 'ok', { version: '4.2.0' }),
      probe<NodeDetail>('node', 'ok', { version: 'v20.10.0', major: 20 }),
      probe<GwsDetail>('gws', 'ok', { version: '0.21.0', absPath: '/x' }),
      probe<GwsVersionDetail>('gws.version', 'stale', {
        installed: '0.21.0',
        required: '0.22.5',
        needsUpgrade: true,
      }),
      probe<GcloudDetail>('gcloud', 'ok', { version: '460.0.0' }),
      probe<GcloudAppDefaultDetail>('gcloud.appDefault', 'ok', { hasToken: true }),
      probe<ClaudeCliDetail>('claude.cli', 'ok', { version: '0.5.0', absPath: '/x' }),
      probe<ClaudeDesktopDetail>('claude.desktop', 'ok', {
        absPath: '/Applications/Claude.app',
        appPath: '/Applications',
      }),
    ];

    const screen = buildConsentScreen(probes);
    expect(screen.willUpgrade.length).toBeGreaterThan(0);
    expect(screen.willUpgrade.some((s) => s.includes('0.21.0'))).toBe(true);
    expect(screen.willUpgrade.some((s) => s.includes('0.22.5'))).toBe(true);
  });
});

describe('MIGRATION_RULES table integrity', () => {
  it('every rule has stable id, predicate, consentLine, and behavior', () => {
    expect(MIGRATION_RULES.length).toBeGreaterThanOrEqual(5);
    const ids = new Set<string>();
    for (const rule of MIGRATION_RULES) {
      expect(typeof rule.id).toBe('string');
      expect(rule.id.length).toBeGreaterThan(0);
      expect(ids.has(rule.id)).toBe(false); // unique
      ids.add(rule.id);
      expect(typeof rule.matches).toBe('function');
      expect(typeof rule.consentLine).toBe('function');
      expect(
        ['skip-install', 'run-oauth', 'pause-with-fix', 'hard-reinstall', 'refuse'],
      ).toContain(rule.behavior);
      if (rule.behavior === 'pause-with-fix') {
        expect(rule.fixHint).toBeDefined();
      }
    }
  });
});
