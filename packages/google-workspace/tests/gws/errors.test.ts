// T7 exit-code-to-error-envelope translation tests.

import { describe, it, expect } from 'vitest';

import {
  STDERR_TAIL_BYTES,
  TIMEOUT_RETRY_AFTER_MS,
  detectApiNotEnabled,
  toolErrorFromGwsResult,
} from '../../src/gws/errors.js';
import { TIMEOUT_EXIT_CODE } from '../../src/gws/runner.js';
import type { RunResult } from '../../src/gws/runner.js';

function mkResult(overrides: Partial<RunResult>): RunResult {
  return {
    exitCode: 1,
    signal: null,
    stdout: '',
    stderr: 'default stderr',
    durationMs: 5,
    gwsVersion: 'gws 0.22.5-fake',
    ...overrides,
  };
}

describe('toolErrorFromGwsResult', () => {
  it('throws on a successful RunResult (programmer error)', () => {
    expect(() => toolErrorFromGwsResult(mkResult({ exitCode: 0 }))).toThrow(
      /successful RunResult/,
    );
  });

  it('maps exit 1 → gws_error', () => {
    const env = toolErrorFromGwsResult(mkResult({ exitCode: 1, stderr: 'boom' }));
    expect(env.error_code).toBe('gws_error');
    expect(env.gws_exit_code).toBe(1);
    expect(env.gws_stderr).toBe('boom');
    expect(env.gws_version).toBe('gws 0.22.5-fake');
  });

  it('maps exit 2 → account_revoked', () => {
    const env = toolErrorFromGwsResult(mkResult({ exitCode: 2, stderr: 'token dead' }));
    expect(env.error_code).toBe('account_revoked');
    expect(env.gws_exit_code).toBe(2);
  });

  it('maps exit 3 → validation_error', () => {
    const env = toolErrorFromGwsResult(mkResult({ exitCode: 3, stderr: 'bad input' }));
    expect(env.error_code).toBe('validation_error');
    expect(env.gws_exit_code).toBe(3);
  });

  it('maps exit 4 → network_error', () => {
    const env = toolErrorFromGwsResult(mkResult({ exitCode: 4, stderr: 'dns down' }));
    expect(env.error_code).toBe('network_error');
    expect(env.gws_exit_code).toBe(4);
    expect(env.retry_after_ms).toBeUndefined();
  });

  it('maps exit 5 → gws_error', () => {
    const env = toolErrorFromGwsResult(mkResult({ exitCode: 5 }));
    expect(env.error_code).toBe('gws_error');
    expect(env.gws_exit_code).toBe(5);
  });

  it('maps timeout (exit -1) → network_error + retry_after_ms hint', () => {
    const env = toolErrorFromGwsResult(
      mkResult({ exitCode: TIMEOUT_EXIT_CODE, signal: 'SIGTERM' }),
    );
    expect(env.error_code).toBe('network_error');
    expect(env.retry_after_ms).toBe(TIMEOUT_RETRY_AFTER_MS);
    expect(env.gws_exit_code).toBe(-1);
  });

  it('maps unknown exit codes (e.g., 99) → gws_error', () => {
    const env = toolErrorFromGwsResult(mkResult({ exitCode: 99, stderr: 'mystery' }));
    expect(env.error_code).toBe('gws_error');
    expect(env.gws_exit_code).toBe(99);
    expect(env.message).toMatch(/unrecognized code 99/);
  });

  it('truncates stderr to the last STDERR_TAIL_BYTES chars', () => {
    const long = 'x'.repeat(STDERR_TAIL_BYTES + 200);
    const marker = 'TAIL_MARKER';
    const stderr = `${long}${marker}`;
    const env = toolErrorFromGwsResult(mkResult({ exitCode: 1, stderr }));
    expect(env.gws_stderr).toBeDefined();
    expect(env.gws_stderr!.length).toBe(STDERR_TAIL_BYTES);
    // The marker is at the tail; it must survive truncation.
    expect(env.gws_stderr).toContain(marker);
  });

  it('always carries a non-empty message', () => {
    for (const code of [1, 2, 3, 4, 5, TIMEOUT_EXIT_CODE, 42] as const) {
      const env = toolErrorFromGwsResult(mkResult({ exitCode: code }));
      expect(env.message.length).toBeGreaterThan(0);
    }
  });

  it('preserves the gws_version field on every envelope', () => {
    const env = toolErrorFromGwsResult(
      mkResult({ exitCode: 4, gwsVersion: 'gws 9.9.9-test' }),
    );
    expect(env.gws_version).toBe('gws 9.9.9-test');
  });

  describe('api_not_enabled detection', () => {
    it('detects "has not been used in project N" signature and returns api_not_enabled', () => {
      const stderr =
        'Error 403: Gmail API has not been used in project 123456789012 before ' +
        'or it is disabled. Enable it by visiting ' +
        'https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123456789012 ' +
        'then retry.';
      const env = toolErrorFromGwsResult(mkResult({ exitCode: 1, stderr }));
      expect(env.error_code).toBe('api_not_enabled');
      expect(env.docs_url).toBe(
        'https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=123456789012',
      );
      expect(env.copyable_command).toBe('gcloud services enable gmail.googleapis.com');
      // Diagnostic metadata still present.
      expect(env.gws_exit_code).toBe(1);
      expect(env.gws_version).toBe('gws 0.22.5-fake');
      expect(env.gws_stderr).toContain('Gmail API');
    });

    it('detects "SERVICE_DISABLED" reason in a JSON error body', () => {
      const stderr = JSON.stringify({
        error: {
          code: 403,
          message: 'Drive API has not been used...',
          status: 'PERMISSION_DENIED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'SERVICE_DISABLED',
              domain: 'googleapis.com',
              metadata: {
                service: 'drive.googleapis.com',
                consumer: 'projects/987654321098',
              },
            },
          ],
        },
      });
      const env = toolErrorFromGwsResult(mkResult({ exitCode: 1, stderr }));
      expect(env.error_code).toBe('api_not_enabled');
      expect(env.docs_url).toContain('drive.googleapis.com');
      expect(env.docs_url).toContain('project=987654321098');
    });

    it('detects a "consumer does not have access to the API" signature', () => {
      const stderr =
        'Request failed: consumer does not have access to the service ' +
        'docs.googleapis.com';
      const env = toolErrorFromGwsResult(mkResult({ exitCode: 1, stderr }));
      expect(env.error_code).toBe('api_not_enabled');
      expect(env.docs_url).toContain('docs.googleapis.com');
    });

    it('omits ?project= qualifier when no project number is present in stderr', () => {
      const stderr =
        'API has not been used — sheets.googleapis.com is disabled for this account.';
      const env = toolErrorFromGwsResult(mkResult({ exitCode: 1, stderr }));
      expect(env.error_code).toBe('api_not_enabled');
      expect(env.docs_url).toBe(
        'https://console.cloud.google.com/apis/library/sheets.googleapis.com',
      );
    });

    it('maps calendar API enablement errors to the correct service host', () => {
      const stderr =
        'Calendar API has not been used in project 555555555555 before or it is disabled. ' +
        'Visit console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=555555555555';
      const env = toolErrorFromGwsResult(mkResult({ exitCode: 1, stderr }));
      expect(env.error_code).toBe('api_not_enabled');
      expect(env.docs_url).toContain('calendar-json.googleapis.com');
      expect(env.docs_url).toContain('project=555555555555');
      expect(env.copyable_command).toBe('gcloud services enable calendar-json.googleapis.com');
    });

    it('falls through to exit-code translation when stderr is unrelated', () => {
      const env = toolErrorFromGwsResult(
        mkResult({ exitCode: 3, stderr: 'invalid argument: --foo' }),
      );
      expect(env.error_code).toBe('validation_error');
      expect(env.gws_exit_code).toBe(3);
    });

    it('falls through to gws_error on generic runtime failures without API signatures', () => {
      const env = toolErrorFromGwsResult(
        mkResult({ exitCode: 1, stderr: 'unexpected EOF while parsing' }),
      );
      expect(env.error_code).toBe('gws_error');
    });
  });

  describe('detectApiNotEnabled (unit)', () => {
    it('returns undefined on empty stderr', () => {
      expect(detectApiNotEnabled('')).toBeUndefined();
    });

    it('returns undefined on unrelated stderr', () => {
      expect(detectApiNotEnabled('some random unrelated error')).toBeUndefined();
    });

    it('extracts service, apiHost, and projectId from canonical Google phrasing', () => {
      const match = detectApiNotEnabled(
        'Gmail API has not been used in project 111222333444 before or it is disabled. ' +
          'Enable it at https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=111222333444',
      );
      expect(match).toBeDefined();
      expect(match!.service).toBe('gmail');
      expect(match!.apiHost).toBe('gmail.googleapis.com');
      expect(match!.projectId).toBe('111222333444');
    });
  });
});
