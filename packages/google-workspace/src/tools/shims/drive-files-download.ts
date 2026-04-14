// drive_files_download — wraps `gws drive files get` with alt=media.
//
// For metadata-only use (id, name, mimeType, revision, size, owners) call
// `drive_files_list` or `drive_files_get` (future). This shim exists so the
// MCP tool manifest matches the plan's 12-shim table; in practice claude.ai's
// hosted Drive connector is better at extracting document text, which is why
// the routing hint points there.

import { z } from 'zod/v3';

import type { ToolDef } from '../types.js';
import {
  mergeParams,
  runGwsJson,
  type ToolContext,
  type ToolResult,
} from './common.js';

export const DriveFilesDownloadInputSchema = z
  .object({
    file_id: z.string().min(1),
    mime_type: z.string().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type DriveFilesDownloadInput = z.infer<typeof DriveFilesDownloadInputSchema>;

export const DriveFilesDownloadOutputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .passthrough();

export type DriveFilesDownloadOutput = z.infer<typeof DriveFilesDownloadOutputSchema>;

export const DRIVE_FILES_DOWNLOAD_DESCRIPTION =
  'Downloads a Google Drive file as raw bytes or extracts its metadata via the Drive API. ' +
  'Use when you need the binary payload or an exact byte-level read. For reading document ' +
  'content extracted as text, prefer claude.ai\'s hosted Drive connector.';

async function invoke(
  args: DriveFilesDownloadInput,
  _ctx: ToolContext,
): Promise<ToolResult<DriveFilesDownloadOutput>> {
  void _ctx;
  const surfaced: Record<string, unknown> = {
    fileId: args.file_id,
    alt: 'media',
  };
  if (args.mime_type !== undefined) surfaced['mimeType'] = args.mime_type;
  const apiParams = mergeParams(surfaced, args.extra_params);

  return runGwsJson(
    {
      subcommand: ['drive', 'files', 'get'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
    },
    DriveFilesDownloadOutputSchema,
  );
}

export const driveFilesDownload: ToolDef<DriveFilesDownloadInput, DriveFilesDownloadOutput> = {
  name: 'drive_files_download',
  description: DRIVE_FILES_DOWNLOAD_DESCRIPTION,
  service: 'drive',
  readonly: true,
  input: DriveFilesDownloadInputSchema,
  output: DriveFilesDownloadOutputSchema,
  invoke,
};
