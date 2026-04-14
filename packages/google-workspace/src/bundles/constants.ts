// Bundle + service constants.
//
// Source of truth for:
//   - SERVICE_SCOPES: each service's Google OAuth scope URLs
//   - BUNDLES: 6 scope bundles (services + deduplicated scope URL union)
//   - SERVICE_PRIMARY_BUNDLE: primary-bundle resolution table (spec §Primary-bundle resolution)
//   - BUNDLES_CONTAINING_SERVICE: reverse index (service → bundles containing it)
//
// All tables are `as const satisfies` typed so that a typo anywhere — a bad
// service name, a bad bundle id, a malformed scope URL — fails `tsc` strictly.
//
// Invariants enforced by tests/bundles/constants.test.ts (AC §S1, §28):
//   1. Each bundle's scopes.length ≤ 24 (1-scope headroom under Google's 25-scope testing cap)
//   2. No duplicate scope URLs within a single bundle
//   3. Every service in SERVICE_PRIMARY_BUNDLE appears in at least one bundle
//   4. Every service listed in a bundle appears in SERVICE_PRIMARY_BUNDLE
//   5. Every service has ≥1 scope URL in SERVICE_SCOPES
//   6. For multi-bundle services, the primary bundle contains the service

import type { BundleDef, BundleId, ScopeUrl, Service } from './types.js';

// ---------- service → scope URLs ----------

/**
 * Per-service Google OAuth scope URLs. Bundle scope lists are computed as the
 * deduplicated union of member services' scopes.
 *
 * Canonical choices per plan.md T3 brief; each is the minimum scope URL that
 * covers the corresponding tool inventory in spec.md §Tool inventory.
 */
export const SERVICE_SCOPES = {
  gmail: ['https://www.googleapis.com/auth/gmail.modify'],
  drive: ['https://www.googleapis.com/auth/drive'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  docs: ['https://www.googleapis.com/auth/documents'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  tasks: ['https://www.googleapis.com/auth/tasks'],
  forms: [
    'https://www.googleapis.com/auth/forms.body',
    'https://www.googleapis.com/auth/forms.responses.readonly',
  ],
  chat: [
    'https://www.googleapis.com/auth/chat.messages',
    'https://www.googleapis.com/auth/chat.spaces',
  ],
  meet: ['https://www.googleapis.com/auth/meetings.space.created'],
  people: ['https://www.googleapis.com/auth/contacts'],
  classroom: [
    'https://www.googleapis.com/auth/classroom.courses',
    'https://www.googleapis.com/auth/classroom.rosters',
  ],
  slides: ['https://www.googleapis.com/auth/presentations'],
  script: ['https://www.googleapis.com/auth/script.projects'],
  'admin-reports': [
    'https://www.googleapis.com/auth/admin.reports.audit.readonly',
    'https://www.googleapis.com/auth/admin.reports.usage.readonly',
  ],
  events: ['https://www.googleapis.com/auth/cloud-platform'],
  modelarmor: ['https://www.googleapis.com/auth/cloud-platform'],
} as const satisfies Record<Service, readonly ScopeUrl[]>;

// ---------- helper: union scopes for a service list, dedup-preserving-order ----------

function unionScopesFor(services: readonly Service[]): readonly ScopeUrl[] {
  const seen = new Set<string>();
  const out: ScopeUrl[] = [];
  for (const svc of services) {
    for (const scope of SERVICE_SCOPES[svc]) {
      if (!seen.has(scope)) {
        seen.add(scope);
        out.push(scope);
      }
    }
  }
  return out;
}

// ---------- bundles ----------

const PRODUCTIVITY_SERVICES = [
  'gmail',
  'drive',
  'calendar',
  'docs',
  'sheets',
  'tasks',
  'forms',
] as const satisfies readonly Service[];

const COLLABORATION_SERVICES = ['chat', 'meet', 'people'] as const satisfies readonly Service[];

const ADMIN_SERVICES = ['admin-reports', 'events', 'modelarmor'] as const satisfies readonly Service[];

const EDUCATION_SERVICES = ['classroom', 'forms', 'meet'] as const satisfies readonly Service[];

const CREATOR_SERVICES = ['slides', 'forms', 'docs', 'drive'] as const satisfies readonly Service[];

const AUTOMATION_SERVICES = ['script', 'events', 'drive'] as const satisfies readonly Service[];

/**
 * The six scope bundles. Per spec §Bundle membership, Forms lives in the
 * Productivity bundle (Forms-primary decision) in addition to Education and
 * Creator.
 */
export const BUNDLES = {
  productivity: {
    id: 'productivity',
    displayName: 'Productivity',
    services: PRODUCTIVITY_SERVICES,
    scopes: unionScopesFor(PRODUCTIVITY_SERVICES),
  },
  collaboration: {
    id: 'collaboration',
    displayName: 'Collaboration',
    services: COLLABORATION_SERVICES,
    scopes: unionScopesFor(COLLABORATION_SERVICES),
  },
  admin: {
    id: 'admin',
    displayName: 'Admin & Compliance',
    services: ADMIN_SERVICES,
    scopes: unionScopesFor(ADMIN_SERVICES),
  },
  education: {
    id: 'education',
    displayName: 'Education',
    services: EDUCATION_SERVICES,
    scopes: unionScopesFor(EDUCATION_SERVICES),
  },
  creator: {
    id: 'creator',
    displayName: 'Creator',
    services: CREATOR_SERVICES,
    scopes: unionScopesFor(CREATOR_SERVICES),
  },
  automation: {
    id: 'automation',
    displayName: 'Automation',
    services: AUTOMATION_SERVICES,
    scopes: unionScopesFor(AUTOMATION_SERVICES),
  },
} as const satisfies Record<BundleId, BundleDef>;

// ---------- primary-bundle + reverse-index tables ----------

/**
 * Primary bundle per service (spec §Primary-bundle resolution). When a tool's
 * service is in no granted bundle, Concierge requests this bundle's consent.
 */
export const SERVICE_PRIMARY_BUNDLE = {
  gmail: 'productivity',
  drive: 'productivity',
  calendar: 'productivity',
  docs: 'productivity',
  sheets: 'productivity',
  tasks: 'productivity',
  forms: 'productivity',
  chat: 'collaboration',
  meet: 'collaboration',
  people: 'collaboration',
  classroom: 'education',
  slides: 'creator',
  script: 'automation',
  'admin-reports': 'admin',
  events: 'admin',
  modelarmor: 'admin',
} as const satisfies Record<Service, BundleId>;

/**
 * Reverse index: for each service, the list of bundles that contain it. A
 * granted bundle in this list satisfies the service with no new consent.
 */
export const BUNDLES_CONTAINING_SERVICE = {
  gmail: ['productivity'],
  drive: ['productivity', 'creator', 'automation'],
  calendar: ['productivity'],
  docs: ['productivity', 'creator'],
  sheets: ['productivity'],
  tasks: ['productivity'],
  forms: ['productivity', 'education', 'creator'],
  chat: ['collaboration'],
  meet: ['collaboration', 'education'],
  people: ['collaboration'],
  classroom: ['education'],
  slides: ['creator'],
  script: ['automation'],
  'admin-reports': ['admin'],
  events: ['admin', 'automation'],
  modelarmor: ['admin'],
} as const satisfies Record<Service, readonly BundleId[]>;

// ---------- public limits ----------

/**
 * Per AC §S1: each bundle must not exceed 24 scopes (1-scope headroom under
 * Google's 25-scope testing-mode cap). Tests in constants.test.ts enforce this
 * invariant; AC §28 requires the test to clearly name any bundle that breaches it.
 */
export const MAX_SCOPES_PER_BUNDLE = 24;
