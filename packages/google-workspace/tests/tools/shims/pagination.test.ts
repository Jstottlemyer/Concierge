// T15 — pagination façade tests.
//
// Exercises the shared pagination helper extracted from the four list shims
// (drive-files-list, chat-spaces-list, forms-responses-list,
// admin-reports-activities-list). Behavior contract:
//   - `max_results` defaults to 50, is translated to the caller's page-size
//     key (pageSize or maxResults), capped at 1000.
//   - `page_token` translates to `pageToken` when present.
//   - `nextPageToken` normalizes to {next_page_token, has_more} with an empty
//     string sentinel when absent.

import { describe, it, expect } from 'vitest';
import { z } from 'zod/v3';

import {
  DEFAULT_MAX_RESULTS,
  MAX_MAX_RESULTS,
  PaginationInputFragment,
  PaginationOutputFragment,
  normalizePaginationResponse,
  toGwsPaginationParams,
} from '../../../src/tools/shims/pagination.js';

describe('pagination façade (T15)', () => {
  describe('toGwsPaginationParams', () => {
    it('defaults max_results to 50 when omitted (pageSize)', () => {
      const out = toGwsPaginationParams({}, { pageSizeKey: 'pageSize' });
      expect(out).toEqual({ pageSize: DEFAULT_MAX_RESULTS });
    });

    it('passes explicit max_results + page_token as pageSize + pageToken', () => {
      const out = toGwsPaginationParams(
        { max_results: 25, page_token: 'xyz' },
        { pageSizeKey: 'pageSize' },
      );
      expect(out).toEqual({ pageSize: 25, pageToken: 'xyz' });
    });

    it('routes to maxResults when service uses that vendor key (admin-reports)', () => {
      const out = toGwsPaginationParams(
        { max_results: 10, page_token: 'tok' },
        { pageSizeKey: 'maxResults' },
      );
      expect(out).toEqual({ maxResults: 10, pageToken: 'tok' });
    });

    it('omits pageToken when page_token is undefined', () => {
      const out = toGwsPaginationParams({ max_results: 7 }, { pageSizeKey: 'pageSize' });
      expect(out).toEqual({ pageSize: 7 });
      expect('pageToken' in out).toBe(false);
    });
  });

  describe('normalizePaginationResponse', () => {
    it('returns {next_page_token, has_more: true} when token is present', () => {
      const out = normalizePaginationResponse({ nextPageToken: 'xyz' });
      expect(out).toEqual({ next_page_token: 'xyz', has_more: true });
    });

    it('returns empty token + has_more:false when nextPageToken is absent', () => {
      const out = normalizePaginationResponse({});
      expect(out).toEqual({ next_page_token: '', has_more: false });
    });

    it('treats an empty-string token as no-more-pages', () => {
      const out = normalizePaginationResponse({ nextPageToken: '' });
      expect(out).toEqual({ next_page_token: '', has_more: false });
    });

    it('ignores unrelated fields on the response object', () => {
      const out = normalizePaginationResponse({
        nextPageToken: 'abc',
        files: [{ id: 'x' }],
        kind: 'drive#fileList',
      });
      expect(out).toEqual({ next_page_token: 'abc', has_more: true });
    });
  });

  describe('Zod fragments', () => {
    it('PaginationInputFragment spreads into a Zod object cleanly and validates bounds', () => {
      const schema = z
        .object({
          ...PaginationInputFragment,
          extra: z.string().optional(),
        })
        .strict();

      // Valid: empty object (everything optional)
      expect(schema.safeParse({}).success).toBe(true);
      // Valid: explicit values
      expect(
        schema.safeParse({ max_results: 100, page_token: 'a', extra: 'ok' }).success,
      ).toBe(true);
      // Invalid: fractional max_results
      expect(schema.safeParse({ max_results: 1.5 }).success).toBe(false);
      // Invalid: above MAX_MAX_RESULTS cap
      expect(schema.safeParse({ max_results: MAX_MAX_RESULTS + 1 }).success).toBe(false);
      // Invalid: below 1
      expect(schema.safeParse({ max_results: 0 }).success).toBe(false);
    });

    it('PaginationOutputFragment spreads into a Zod object with required has_more + next_page_token', () => {
      const schema = z
        .object({
          items: z.array(z.string()),
          ...PaginationOutputFragment,
        })
        .passthrough();

      expect(
        schema.safeParse({ items: [], next_page_token: '', has_more: false }).success,
      ).toBe(true);
      expect(
        schema.safeParse({ items: ['a'], next_page_token: 't', has_more: true }).success,
      ).toBe(true);
      // Missing has_more should fail
      expect(schema.safeParse({ items: [], next_page_token: '' }).success).toBe(false);
    });
  });
});
