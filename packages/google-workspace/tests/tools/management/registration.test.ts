// Management-tool registration test — every management tool lands in the
// registry with compliant metadata and clean description lints. Originally
// T14 (5 tools); grew to 6 with `concierge_info`; grew to 7 with
// `concierge_help` (user-education surface).

import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetRegistryForTests,
  getAllTools,
  getToolByName,
  getToolsByName,
} from '../../../src/tools/registry.js';
import {
  registerManagementTools,
  MANAGEMENT_TOOLS,
} from '../../../src/tools/management/index.js';
import { auditAllDescriptions, auditFailures } from '../../../src/tools/mcp-schema.js';

const EXPECTED_NAMES = [
  'concierge_help',
  'concierge_info',
  'factory_reset',
  'list_accounts',
  'remove_account',
  'set_default_account',
  'set_read_only',
] as const;

describe('management tool registration', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('exports exactly 7 management tools', () => {
    expect(MANAGEMENT_TOOLS).toHaveLength(7);
  });

  it('registerManagementTools lands every expected tool in the registry', () => {
    registerManagementTools();
    expect(getAllTools()).toHaveLength(7);
    const byName = getToolsByName();
    for (const name of EXPECTED_NAMES) {
      expect(byName[name]).toBeDefined();
    }
  });

  it('lookup by name returns the same module-exported tool', () => {
    registerManagementTools();
    for (const expected of MANAGEMENT_TOOLS) {
      expect(getToolByName(expected.name)).toBe(expected);
    }
  });

  it('every tool advertises service: management', () => {
    registerManagementTools();
    for (const tool of getAllTools()) {
      expect(tool.service).toBe('management');
    }
  });

  it('readonly flags match the management-tool table', () => {
    registerManagementTools();
    const expectedReadonly: Record<string, boolean> = {
      concierge_help: true,
      concierge_info: true,
      list_accounts: true,
      set_default_account: false,
      remove_account: false,
      factory_reset: false,
      set_read_only: false,
    };
    for (const tool of getAllTools()) {
      expect(expectedReadonly[tool.name]).toBe(tool.readonly);
    }
  });

  it('all descriptions pass Decision #13.5 lint', () => {
    registerManagementTools();
    const failures = auditFailures(auditAllDescriptions(getAllTools()));
    if (failures.length > 0) {
      const detail = failures
        .map((f) => `  ${f.tool}: ${f.result.warnings.join('; ')}`)
        .join('\n');
      throw new Error(`description-lint warnings:\n${detail}`);
    }
    expect(failures).toHaveLength(0);
  });

  it('registerManagementTools is non-idempotent (second call throws duplicate-name)', () => {
    registerManagementTools();
    expect(() => registerManagementTools()).toThrow(/already registered|duplicate/);
  });
});
