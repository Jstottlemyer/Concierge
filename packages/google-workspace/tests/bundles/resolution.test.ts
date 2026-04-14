// Bundle resolution helper tests.
//
// Covers spec §Primary-bundle resolution: each service's primary bundle, the
// reverse-index lookup for multi-bundle services, and the "granted bundle
// satisfies a service with no new consent" shortcut.

import { describe, expect, it } from 'vitest';

import {
  getBundlesContainingService,
  getPrimaryBundleForService,
  isServiceInGrantedBundle,
} from '../../src/bundles/resolution.js';
import type { BundleId, Service } from '../../src/bundles/types.js';

describe('getPrimaryBundleForService — one row per service in spec §Primary-bundle resolution', () => {
  const cases: ReadonlyArray<readonly [Service, BundleId]> = [
    ['gmail', 'productivity'],
    ['drive', 'productivity'],
    ['calendar', 'productivity'],
    ['docs', 'productivity'],
    ['sheets', 'productivity'],
    ['tasks', 'productivity'],
    ['forms', 'productivity'],
    ['chat', 'collaboration'],
    ['meet', 'collaboration'],
    ['people', 'collaboration'],
    ['classroom', 'education'],
    ['slides', 'creator'],
    ['script', 'automation'],
    ['admin-reports', 'admin'],
    ['events', 'admin'],
    ['modelarmor', 'admin'],
  ];

  for (const [service, expected] of cases) {
    it(`${service} → ${expected}`, () => {
      expect(getPrimaryBundleForService(service)).toBe(expected);
    });
  }
});

describe('getBundlesContainingService — multi-bundle services resolve correctly', () => {
  const multi: ReadonlyArray<readonly [Service, readonly BundleId[]]> = [
    ['drive', ['productivity', 'creator', 'automation']],
    ['docs', ['productivity', 'creator']],
    ['forms', ['productivity', 'education', 'creator']],
    ['meet', ['collaboration', 'education']],
    ['events', ['admin', 'automation']],
  ];

  for (const [service, expected] of multi) {
    it(`${service} is in [${expected.join(', ')}]`, () => {
      expect([...getBundlesContainingService(service)].sort()).toEqual([...expected].sort());
    });
  }

  it('single-bundle service (gmail) returns exactly one bundle', () => {
    expect(getBundlesContainingService('gmail')).toEqual(['productivity']);
  });

  it('single-bundle service (classroom) returns exactly one bundle', () => {
    expect(getBundlesContainingService('classroom')).toEqual(['education']);
  });

  it('for multi-bundle services, primary bundle is always in the containing list', () => {
    const services: readonly Service[] = ['drive', 'docs', 'forms', 'meet', 'events'];
    for (const svc of services) {
      const primary = getPrimaryBundleForService(svc);
      const containing = getBundlesContainingService(svc);
      expect(containing, `${svc}: primary=${primary} must be in containing`).toContain(primary);
    }
  });
});

describe('isServiceInGrantedBundle — granted-bundle satisfies service (no new consent)', () => {
  it('granted primary bundle satisfies a single-bundle service', () => {
    expect(isServiceInGrantedBundle('gmail', ['productivity'])).toBe(true);
  });

  it('granted non-primary bundle satisfies a multi-bundle service (drive via automation)', () => {
    expect(isServiceInGrantedBundle('drive', ['automation'])).toBe(true);
  });

  it('granted non-primary bundle satisfies a multi-bundle service (drive via creator)', () => {
    expect(isServiceInGrantedBundle('drive', ['creator'])).toBe(true);
  });

  it('granted non-primary bundle satisfies forms (via education)', () => {
    expect(isServiceInGrantedBundle('forms', ['education'])).toBe(true);
  });

  it('granted non-primary bundle satisfies meet (via education)', () => {
    expect(isServiceInGrantedBundle('meet', ['education'])).toBe(true);
  });

  it('granted non-primary bundle satisfies events (via automation)', () => {
    expect(isServiceInGrantedBundle('events', ['automation'])).toBe(true);
  });

  it('unrelated granted bundle does NOT satisfy a single-bundle service', () => {
    expect(isServiceInGrantedBundle('gmail', ['admin'])).toBe(false);
  });

  it('unrelated granted bundle does NOT satisfy a multi-bundle service', () => {
    expect(isServiceInGrantedBundle('drive', ['collaboration'])).toBe(false);
  });

  it('empty granted-bundle list returns false (forces consent request)', () => {
    expect(isServiceInGrantedBundle('gmail', [])).toBe(false);
  });

  it('returns true if ANY granted bundle contains the service (multi-grant case)', () => {
    expect(isServiceInGrantedBundle('drive', ['admin', 'creator'])).toBe(true);
  });

  it('admin-only grant satisfies admin-reports but not gmail', () => {
    expect(isServiceInGrantedBundle('admin-reports', ['admin'])).toBe(true);
    expect(isServiceInGrantedBundle('gmail', ['admin'])).toBe(false);
  });
});
