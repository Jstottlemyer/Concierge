// T12 shim registrations — call `registerShimTools()` from the server
// bootstrap once (before `finalizeRegistry()`). Keeping registration in one
// function avoids side-effects at module-load time, so tests can import
// individual shims without touching the global registry.

import { registerTool } from '../registry.js';
import type { AnyToolDef, ToolDef } from '../types.js';

import { driveFilesList } from './drive-files-list.js';
import { driveFilesDownload } from './drive-files-download.js';
import { drivePermissionsCreate } from './drive-permissions-create.js';
import { docsDocumentsGet } from './docs-documents-get.js';
import { docsDocumentsCreate } from './docs-documents-create.js';
import { sheetsSpreadsheetsCreate } from './sheets-spreadsheets-create.js';
import { chatSpacesList } from './chat-spaces-list.js';
import { meetSpacesCreate } from './meet-spaces-create.js';
import { formsFormsCreate } from './forms-forms-create.js';
import { formsResponsesList } from './forms-responses-list.js';
import { adminReportsActivitiesList } from './admin-reports-activities-list.js';
import { adminReportsUsageGet } from './admin-reports-usage-get.js';

/**
 * All 12 T12 shim definitions, in stable registration order.
 *
 * Typed as `readonly AnyToolDef[]` because the members have heterogeneous
 * Input/Output generics; the registry consumes `AnyToolDef` anyway after
 * erasing the per-tool generics. Individual shim modules still export their
 * concrete `ToolDef<Input, Output>` for direct test imports.
 */
export const SHIM_TOOLS: readonly AnyToolDef[] = [
  driveFilesList as unknown as AnyToolDef,
  driveFilesDownload as unknown as AnyToolDef,
  drivePermissionsCreate as unknown as AnyToolDef,
  docsDocumentsGet as unknown as AnyToolDef,
  docsDocumentsCreate as unknown as AnyToolDef,
  sheetsSpreadsheetsCreate as unknown as AnyToolDef,
  chatSpacesList as unknown as AnyToolDef,
  meetSpacesCreate as unknown as AnyToolDef,
  formsFormsCreate as unknown as AnyToolDef,
  formsResponsesList as unknown as AnyToolDef,
  adminReportsActivitiesList as unknown as AnyToolDef,
  adminReportsUsageGet as unknown as AnyToolDef,
];

/**
 * Register all 12 T12 shims with the tool registry. Idempotent only up to
 * the underlying `registerTool` contract — calling twice raises
 * `registry_duplicate_name`. Call once at bootstrap.
 */
export function registerShimTools(): void {
  for (const tool of SHIM_TOOLS) {
    // `registerTool` is generic over Input/Output; the SHIM_TOOLS tuple
    // erases those to AnyToolDef so the heterogeneous list is storable.
    // Cast back to a permissive ToolDef so the registry's generic call
    // doesn't require us to reconstruct the per-tool type parameters.
    registerTool(tool as unknown as ToolDef<unknown, unknown>);
  }
}

// Re-export individual shim modules for direct import by tests and other
// registration collectors.
export {
  driveFilesList,
  driveFilesDownload,
  drivePermissionsCreate,
  docsDocumentsGet,
  docsDocumentsCreate,
  sheetsSpreadsheetsCreate,
  chatSpacesList,
  meetSpacesCreate,
  formsFormsCreate,
  formsResponsesList,
  adminReportsActivitiesList,
  adminReportsUsageGet,
};
