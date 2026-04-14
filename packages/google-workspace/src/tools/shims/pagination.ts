// Shared pagination façade for Concierge list shims.
//
// Changelog:
//   - T15 (Wave 7): Extracted from per-shim copies in drive-files-list,
//     chat-spaces-list, forms-responses-list, and admin-reports-activities-list.
//     Centralizes the max_results → pageSize|maxResults translation and the
//     nextPageToken → {has_more, next_page_token} normalization so every list
//     shim speaks the same pagination dialect (plan.md Decision #10).
//
// Usage (in a list shim):
//
//   export const MyListInputSchema = z.object({
//     ...PaginationInputFragment,
//     // other surfaced fields...
//   }).strict();
//
//   export const MyListOutputSchema = z.object({
//     items: z.array(...),
//     ...PaginationOutputFragment,
//   }).passthrough();
//
//   // in invoke():
//   const surfaced = {
//     ...toGwsPaginationParams(args, { pageSizeKey: 'pageSize' }),
//     // other surfaced params...
//   };
//   // ...runGwsJson...
//   const pagination = normalizePaginationResponse(raw.data);
//   return { ok: true, data: { items, ...pagination } };
//
// Services using `pageSize` (default): drive, chat, forms, etc.
// Services using `maxResults`: admin-reports.

import { z } from 'zod/v3';

/** Default page size when the caller does not supply `max_results`. */
export const DEFAULT_MAX_RESULTS = 50;

/** Upper bound on `max_results` to prevent absurd requests. */
export const MAX_MAX_RESULTS = 1000;

/**
 * Zod input fragment — spread into a shim's InputSchema object. Declares
 * `max_results` (optional, bounded 1..1000) and `page_token` (optional).
 *
 * `max_results` is kept optional (rather than `.default(50)`) because shims
 * are invoked in two ways:
 *   - via the MCP dispatcher, which parses the input through the Zod schema
 *     (applying any default), and
 *   - via tests, which pass raw objects directly to `invoke` without going
 *     through Zod.
 *
 * Leaving the field optional and letting `toGwsPaginationParams` apply the
 * default at params-construction time keeps both paths correct.
 */
export const PaginationInputFragment = {
  max_results: z
    .number()
    .int()
    .min(1)
    .max(MAX_MAX_RESULTS)
    .optional()
    .describe(
      `Maximum items to return in one page. Default ${String(DEFAULT_MAX_RESULTS)}, capped at ${String(MAX_MAX_RESULTS)}.`,
    ),
  page_token: z
    .string()
    .optional()
    .describe('Token for the next page, obtained from a prior call.'),
} as const;

/**
 * Zod output fragment — spread into a shim's OutputSchema object. Declares
 * the two normalized pagination fields every list shim surfaces.
 *
 * `next_page_token` is always a string: either the vendor-supplied token or
 * the empty string when there is no further page. Callers check `has_more`
 * to decide whether to paginate; the empty-string sentinel keeps the shape
 * stable across calls.
 */
export const PaginationOutputFragment = {
  next_page_token: z
    .string()
    .describe(
      'Token to pass as page_token to retrieve the next page. Empty string when no further page.',
    ),
  has_more: z
    .boolean()
    .describe('Whether more pages exist beyond this response.'),
} as const;

/** Input shape accepted by `toGwsPaginationParams`.
 *
 * Fields use `| undefined` explicitly (rather than `?:`) so shim-owned
 * InputSchemas — whose Zod-inferred types include `| undefined` under
 * `exactOptionalPropertyTypes: true` — can be passed directly without a
 * narrowing step.
 */
export interface PaginationInput {
  readonly max_results?: number | undefined;
  readonly page_token?: string | undefined;
}

/** Options for `toGwsPaginationParams`. */
export interface PaginationParamOptions {
  /**
   * Which Google API field name this service uses for page size.
   *   - `pageSize`   → most modern Google APIs (drive, chat, forms, ...)
   *   - `maxResults` → admin-reports API
   */
  readonly pageSizeKey: 'pageSize' | 'maxResults';
}

/**
 * Translate Concierge-owned pagination params into gws `--params` JSON entries.
 * Caller merges the return value into the broader params object (typically
 * via object spread).
 *
 * The result always contains the page-size key (named per `pageSizeKey`) and
 * only contains `pageToken` when the caller supplied one.
 */
export function toGwsPaginationParams(
  args: PaginationInput,
  opts: PaginationParamOptions,
): Record<string, unknown> {
  const pageSize = args.max_results ?? DEFAULT_MAX_RESULTS;
  const out: Record<string, unknown> = {
    [opts.pageSizeKey]: pageSize,
  };
  if (args.page_token !== undefined) {
    out['pageToken'] = args.page_token;
  }
  return out;
}

/**
 * Normalize a vendor response's `nextPageToken` to the Concierge-facing
 * `{next_page_token, has_more}` pair. Accepts any object that may have a
 * `nextPageToken` string field and returns just the pagination fields.
 *
 *   - Present non-empty token → `{next_page_token: <tok>, has_more: true}`
 *   - Absent or empty token   → `{next_page_token: '', has_more: false}`
 *
 * `next_page_token` is always a string so the output shape is stable; use
 * `has_more` to branch on whether another page exists.
 */
export function normalizePaginationResponse(response: {
  nextPageToken?: string | undefined;
  [key: string]: unknown;
}): { next_page_token: string; has_more: boolean } {
  const token = response.nextPageToken ?? '';
  return { next_page_token: token, has_more: token.length > 0 };
}
