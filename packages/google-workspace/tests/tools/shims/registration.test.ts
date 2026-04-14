// T12 shim registration test — all 12 shims land in the registry with
// compliant metadata and clean description lints.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetRegistryForTests,
  getAllTools,
  getToolByName,
  getToolsByName,
} from '../../../src/tools/registry.js';
import { registerShimTools, SHIM_TOOLS } from '../../../src/tools/shims/index.js';
import { auditAllDescriptions, auditFailures } from '../../../src/tools/mcp-schema.js';

const EXPECTED_NAMES = [
  'drive_files_list',
  'drive_files_download',
  'drive_permissions_create',
  'docs_documents_get',
  'docs_documents_create',
  'sheets_spreadsheets_create',
  'chat_spaces_list',
  'meet_spaces_create',
  'forms_forms_create',
  'forms_responses_list',
  'admin_reports_activities_list',
  'admin_reports_usage_get',
] as const;

describe('T12 shim registration', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('registers exactly 12 shims', () => {
    registerShimTools();
    expect(getAllTools()).toHaveLength(12);
    expect(SHIM_TOOLS).toHaveLength(12);
  });

  it('all expected names are present', () => {
    registerShimTools();
    const byName = getToolsByName();
    for (const name of EXPECTED_NAMES) {
      expect(byName[name]).toBeDefined();
    }
  });

  it('lookup by name returns the same module-exported tool', () => {
    registerShimTools();
    for (const expected of SHIM_TOOLS) {
      expect(getToolByName(expected.name)).toBe(expected);
    }
  });

  it('readonly flags match the shim table', () => {
    registerShimTools();
    const expectedReadonly: Record<string, boolean> = {
      drive_files_list: true,
      drive_files_download: true,
      drive_permissions_create: false,
      docs_documents_get: true,
      docs_documents_create: false,
      sheets_spreadsheets_create: false,
      chat_spaces_list: true,
      meet_spaces_create: false,
      forms_forms_create: false,
      forms_responses_list: true,
      admin_reports_activities_list: true,
      admin_reports_usage_get: true,
    };
    for (const tool of getAllTools()) {
      expect(expectedReadonly[tool.name]).toBe(tool.readonly);
    }
  });

  it('all descriptions pass Decision #13.5 lint', () => {
    registerShimTools();
    const failures = auditFailures(auditAllDescriptions(getAllTools()));
    if (failures.length > 0) {
      // Helpful error output so the CI log pinpoints the offender.
      const detail = failures
        .map((f) => `  ${f.tool}: ${f.result.warnings.join('; ')}`)
        .join('\n');
      throw new Error(`description-lint warnings:\n${detail}`);
    }
    expect(failures).toHaveLength(0);
  });

  it('registerShimTools is non-idempotent (second call throws duplicate-name)', () => {
    registerShimTools();
    expect(() => registerShimTools()).toThrow(/already registered|duplicate/);
  });
});
