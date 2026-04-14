// T5: confirmation-phrase validator tests.
//
// Covers plan.md Decision #5 + spec.md §"Destructive operations":
//   - canonical phrase per op+target
//   - exact-string match, case-sensitive
//   - whitespace normalization (trim + collapse internal runs)
//   - rejects substrings / supersets / case variants
//   - buildConfirmationRequiredResponse emits a phrase-consistent envelope

import { describe, it, expect } from 'vitest';

import {
  CANONICAL_PHRASES,
  canonicalPhrase,
  normalizeConfirmationInput,
  verifyConfirmation,
} from '../../src/confirmation/phrases.js';
import { buildConfirmationRequiredResponse } from '../../src/confirmation/response.js';

describe('CANONICAL_PHRASES table', () => {
  it('renders remove_account as `remove <email>`', () => {
    expect(CANONICAL_PHRASES.remove_account({ email: 'alice@example.com' })).toBe(
      'remove alice@example.com',
    );
  });

  it('renders factory_reset as the fixed credentials phrase', () => {
    expect(CANONICAL_PHRASES.factory_reset({})).toBe('yes delete all my google credentials');
  });

  it('renders set_read_only_off as `enable writes for <account>`', () => {
    expect(CANONICAL_PHRASES.set_read_only_off({ account: 'bob@example.com' })).toBe(
      'enable writes for bob@example.com',
    );
  });

  it('renders drive cross-domain share as `share with <target_email>`', () => {
    expect(
      CANONICAL_PHRASES.drive_permissions_create_cross_domain({ email: 'carol@outside.org' }),
    ).toBe('share with carol@outside.org');
  });

  it('canonicalPhrase() typed helper agrees with the raw table entries', () => {
    expect(canonicalPhrase('remove_account', { email: 'a@b.com' })).toBe('remove a@b.com');
    expect(canonicalPhrase('factory_reset', {})).toBe('yes delete all my google credentials');
  });
});

describe('normalizeConfirmationInput', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeConfirmationInput('  hello world  ')).toBe('hello world');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeConfirmationInput('hello     world')).toBe('hello world');
    expect(normalizeConfirmationInput('hello\t\tworld')).toBe('hello world');
    expect(normalizeConfirmationInput('hello\nworld')).toBe('hello world');
  });

  it('preserves case', () => {
    expect(normalizeConfirmationInput('Hello World')).toBe('Hello World');
  });
});

describe('verifyConfirmation — match', () => {
  it('matches the exact canonical phrase', () => {
    const result = verifyConfirmation(
      'remove_account',
      { email: 'alice@example.com' },
      'remove alice@example.com',
    );
    expect(result).toEqual({ match: true });
  });

  it('matches after leading/trailing whitespace trim', () => {
    const result = verifyConfirmation(
      'remove_account',
      { email: 'alice@example.com' },
      '   remove alice@example.com   ',
    );
    expect(result).toEqual({ match: true });
  });

  it('matches after internal whitespace collapse', () => {
    const result = verifyConfirmation(
      'factory_reset',
      {},
      'yes   delete  all   my google credentials',
    );
    expect(result).toEqual({ match: true });
  });

  it('matches set_read_only_off with the target account', () => {
    const result = verifyConfirmation(
      'set_read_only_off',
      { account: 'bob@example.com' },
      'enable writes for bob@example.com',
    );
    expect(result).toEqual({ match: true });
  });
});

describe('verifyConfirmation — mismatch', () => {
  it('rejects a wrong target (different email)', () => {
    const result = verifyConfirmation(
      'remove_account',
      { email: 'alice@example.com' },
      'remove bob@example.com',
    );
    expect(result).toEqual({ match: false, required: 'remove alice@example.com' });
  });

  it('rejects a superset — extra trailing word', () => {
    const result = verifyConfirmation(
      'remove_account',
      { email: 'alice@example.com' },
      'remove alice@example.com please',
    );
    expect(result).toEqual({ match: false, required: 'remove alice@example.com' });
  });

  it('rejects a superset — extra leading word', () => {
    const result = verifyConfirmation(
      'factory_reset',
      {},
      'really yes delete all my google credentials',
    );
    expect(result.match).toBe(false);
  });

  it('rejects a strict substring (missing final word)', () => {
    const result = verifyConfirmation('factory_reset', {}, 'yes delete all my google');
    expect(result.match).toBe(false);
  });

  it('rejects case mismatch — uppercase variant', () => {
    const result = verifyConfirmation(
      'remove_account',
      { email: 'Alice@Example.com' },
      'REMOVE Alice@Example.com',
    );
    expect(result).toEqual({ match: false, required: 'remove Alice@Example.com' });
  });

  it('rejects case mismatch — capitalized word', () => {
    const result = verifyConfirmation(
      'factory_reset',
      {},
      'Yes delete all my google credentials',
    );
    expect(result.match).toBe(false);
  });

  it('rejects an empty confirmation', () => {
    const result = verifyConfirmation(
      'remove_account',
      { email: 'alice@example.com' },
      '',
    );
    expect(result).toEqual({ match: false, required: 'remove alice@example.com' });
  });

  it('surfaces the correct required phrase on mismatch for every op', () => {
    const removeResult = verifyConfirmation(
      'remove_account',
      { email: 'a@b.com' },
      'nope',
    );
    expect(removeResult).toEqual({ match: false, required: 'remove a@b.com' });

    const resetResult = verifyConfirmation('factory_reset', {}, 'nope');
    expect(resetResult).toEqual({
      match: false,
      required: 'yes delete all my google credentials',
    });

    const readOnlyResult = verifyConfirmation(
      'set_read_only_off',
      { account: 'c@d.com' },
      'nope',
    );
    expect(readOnlyResult).toEqual({ match: false, required: 'enable writes for c@d.com' });

    const shareResult = verifyConfirmation(
      'drive_permissions_create_cross_domain',
      { email: 'e@f.com' },
      'nope',
    );
    expect(shareResult).toEqual({ match: false, required: 'share with e@f.com' });
  });
});

describe('buildConfirmationRequiredResponse', () => {
  it('returns a confirmation_required envelope with matching phrase + next_call', () => {
    const env = buildConfirmationRequiredResponse(
      'remove_account',
      { email: 'alice@example.com' },
      'This will permanently remove alice@example.com from Concierge.',
    );

    expect(env.ok).toBe(false);
    expect(env.error_code).toBe('confirmation_required');
    expect(env.message).toMatch(/alice@example\.com/);
    expect(env.confirmation_phrase).toBe('remove alice@example.com');
    expect(env.next_call).toEqual({
      tool: 'remove_account',
      arguments: { email: 'alice@example.com', confirm: 'remove alice@example.com' },
    });
  });

  it('maps set_read_only_off back to the `set_read_only` tool with enabled:false', () => {
    const env = buildConfirmationRequiredResponse(
      'set_read_only_off',
      { account: 'bob@example.com' },
      'Disabling Read-Only re-consents to writable scopes.',
    );

    expect(env.next_call).toEqual({
      tool: 'set_read_only',
      arguments: {
        account: 'bob@example.com',
        enabled: false,
        confirm: 'enable writes for bob@example.com',
      },
    });
  });

  it('handles factory_reset with empty arguments plus confirm', () => {
    const env = buildConfirmationRequiredResponse(
      'factory_reset',
      {},
      'This will delete all Concierge credentials.',
    );

    expect(env.confirmation_phrase).toBe('yes delete all my google credentials');
    expect(env.next_call).toEqual({
      tool: 'factory_reset',
      arguments: { confirm: 'yes delete all my google credentials' },
    });
  });

  it('handles drive cross-domain share', () => {
    const env = buildConfirmationRequiredResponse(
      'drive_permissions_create_cross_domain',
      { email: 'carol@outside.org' },
      'carol@outside.org is outside your domain.',
    );

    expect(env.confirmation_phrase).toBe('share with carol@outside.org');
    expect(env.next_call).toEqual({
      tool: 'drive_permissions_create',
      arguments: { email: 'carol@outside.org', confirm: 'share with carol@outside.org' },
    });
  });

  it('phrase in confirmation_phrase always matches next_call.arguments.confirm', () => {
    const env = buildConfirmationRequiredResponse(
      'remove_account',
      { email: 'x@y.com' },
      'warning',
    );
    expect(env.next_call?.arguments['confirm']).toBe(env.confirmation_phrase);
  });
});
