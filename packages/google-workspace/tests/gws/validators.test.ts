// T7 validator tests — accept/reject matrices for every public validator.

import { describe, it, expect } from 'vitest';

import { ConciergeError } from '@concierge/core/errors';
import {
  DENYLISTED_FLAGS,
  validateAccountOptional,
  validateArgumentNotFlag,
  validateEmail,
  validateMethod,
  validateResource,
  validateService,
} from '../../src/gws/validators.js';

function expectValidationError(fn: () => unknown): void {
  try {
    fn();
    throw new Error('expected validation_error but none thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(ConciergeError);
    expect((err as ConciergeError).code).toBe('validation_error');
  }
}

describe('validateService', () => {
  it.each(['gmail', 'drive', 'calendar', 'admin-reports', 'modelarmor', 'a', 'a1', 'a_b'])(
    'accepts %s',
    (input) => {
      expect(validateService(input)).toBe(input);
    },
  );

  it.each([
    '',
    'Gmail', // leading capital
    '1gmail', // leading digit
    '-gmail', // leading dash
    '_gmail', // leading underscore
    'gmail.com', // dot
    'gmail/drive', // slash
    'gmail drive', // space
    'g'.repeat(50), // too long (>49)
    'admin reports', // space
  ])('rejects %s', (input) => {
    expectValidationError(() => validateService(input));
  });

  it('rejects non-string input', () => {
    expectValidationError(() => validateService(42 as unknown as string));
    expectValidationError(() => validateService(null as unknown as string));
    expectValidationError(() => validateService(undefined as unknown as string));
  });
});

describe('validateResource', () => {
  it.each(['files', 'messages', 'users', 'events', 'threads', 'labels'])(
    'accepts %s',
    (input) => {
      expect(validateResource(input)).toBe(input);
    },
  );

  it.each(['', 'Files', '3messages', '--files', 'files/foo'])('rejects %s', (input) => {
    expectValidationError(() => validateResource(input));
  });
});

describe('validateMethod', () => {
  it.each(['list', 'get', 'create', 'delete', 'batchGet', 'list-v2'])(
    'accepts %s',
    (input) => {
      expect(validateMethod(input)).toBe(input);
    },
  );

  it.each(['', 'List', '2list', 'list foo', 'list.foo'])('rejects %s', (input) => {
    expectValidationError(() => validateMethod(input));
  });
});

describe('validateEmail', () => {
  it.each([
    'alice@example.com',
    'a.b+tag@example.co.uk',
    'user@sub.domain.example',
    'first-last@example.com',
    'a@b.c',
    'with_underscore@example.org',
  ])('accepts %s', (input) => {
    expect(validateEmail(input)).toBe(input);
  });

  it.each([
    '',
    'no-at-sign.com',
    '@no-local.com',
    'no-domain@',
    'no-dot@domain',
    'with space@example.com',
    'bracket<@example.com',
    'bracket>@example.com',
    'two@@example.com',
  ])('rejects %s', (input) => {
    expectValidationError(() => validateEmail(input));
  });

  it('rejects emails longer than 254 chars', () => {
    const local = 'a'.repeat(250);
    const email = `${local}@b.co`;
    expect(email.length).toBeGreaterThan(254);
    expectValidationError(() => validateEmail(email));
  });
});

describe('validateArgumentNotFlag', () => {
  it.each([
    'hello world',
    'Project Q4',
    'user@example.com',
    'drive_files_list',
    'path/to/something',
    '-single-dash', // single dash is allowed as data
    '2024-Q4 roadmap',
  ])('accepts %s', (input) => {
    expect(validateArgumentNotFlag(input)).toBe(input);
  });

  it.each([
    '--credentials',
    '--credentials=stolen',
    '--config',
    '--config=/etc/shadow',
    '--auth-override',
    '--auth-override=bad',
    '--dangerous',
    '--anything',
    '--',
  ])('rejects flag-shaped %s', (input) => {
    expectValidationError(() => validateArgumentNotFlag(input));
  });

  it('exposes the denylist for audit', () => {
    expect(DENYLISTED_FLAGS).toContain('--credentials');
    expect(DENYLISTED_FLAGS).toContain('--config');
    expect(DENYLISTED_FLAGS).toContain('--auth-override');
  });
});

describe('validateAccountOptional', () => {
  it('returns undefined for undefined input', () => {
    expect(validateAccountOptional(undefined)).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(validateAccountOptional(null)).toBeUndefined();
  });

  it('returns the email for a valid address', () => {
    expect(validateAccountOptional('alice@example.com')).toBe('alice@example.com');
  });

  it('rejects invalid emails', () => {
    expectValidationError(() => validateAccountOptional('not-an-email'));
    expectValidationError(() => validateAccountOptional(''));
  });
});
