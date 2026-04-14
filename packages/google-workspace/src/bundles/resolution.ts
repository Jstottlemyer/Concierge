// Bundle resolution helpers.
//
// Given a service, which bundles contain it? Which is its primary? If any of
// the caller's granted bundles contains the service, no new consent is needed.
//
// All lookups are O(1) on the tables in constants.ts.

import { BUNDLES_CONTAINING_SERVICE, SERVICE_PRIMARY_BUNDLE } from './constants.js';
import type { BundleId, Service } from './types.js';

/**
 * The full list of bundles containing the given service (spec §Primary-bundle resolution).
 * For single-bundle services, the list has length 1.
 */
export function getBundlesContainingService(service: Service): readonly BundleId[] {
  return BUNDLES_CONTAINING_SERVICE[service];
}

/**
 * The service's primary bundle — the one Concierge requests when no granted
 * bundle contains the service (spec §Primary-bundle resolution).
 */
export function getPrimaryBundleForService(service: Service): BundleId {
  return SERVICE_PRIMARY_BUNDLE[service];
}

/**
 * True if at least one of the caller's granted bundles contains the service.
 * When this returns true, the tool works with no new consent (spec §Bundle membership).
 */
export function isServiceInGrantedBundle(
  service: Service,
  grantedBundles: readonly BundleId[],
): boolean {
  const containing: readonly BundleId[] = BUNDLES_CONTAINING_SERVICE[service];
  for (const granted of grantedBundles) {
    if (containing.includes(granted)) {
      return true;
    }
  }
  return false;
}
