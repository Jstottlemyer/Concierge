// PII pattern tests — the four D17 additions.
//
// These patterns ONLY apply via `redactStringForLog` / `redactForLog`,
// not the credential-shape `redactString`. Each test asserts (a) the
// expected placeholder shows up and (b) the original sensitive string
// does not survive in the output.
//
// Spec ref: setup-hardening-v2 spec D17, plan A3.

import { describe, it, expect } from 'vitest';

import {
  redactString,
  redactStringForLog,
} from '../../src/log/redact.js';

describe('PII pattern: email addresses', () => {
  it('redacts a bare email to [email]', () => {
    const input = 'send report to alice@example.com please';
    const out = redactStringForLog(input);
    expect(out).toBe('send report to [email] please');
    expect(out).not.toContain('alice@example.com');
  });

  it('redacts emails with subdomains and plus addressing', () => {
    const input = 'cc bob+filter@mail.corp.example.co.uk done';
    const out = redactStringForLog(input);
    expect(out).toContain('[email]');
    expect(out).not.toContain('bob+filter@mail.corp.example.co.uk');
  });

  it('credential-only redactString does NOT touch emails (round-trip safe)', () => {
    const input = 'user: alice@example.com';
    expect(redactString(input)).toBe(input);
  });
});

describe('PII pattern: filesystem usernames in /Users/{name}/ paths', () => {
  it('replaces the username segment with ~', () => {
    const input = 'log path: /Users/justin/Library/Logs/app.log';
    const out = redactStringForLog(input);
    expect(out).toBe('log path: /Users/~/Library/Logs/app.log');
    expect(out).not.toContain('/Users/justin/');
  });

  it('handles trailing-username (no trailing slash)', () => {
    const input = 'home is /Users/alice';
    const out = redactStringForLog(input);
    expect(out).toBe('home is /Users/~');
    expect(out).not.toContain('/Users/alice');
  });

  it('credential-only redactString does NOT touch /Users/ paths', () => {
    const input = '/Users/justin/Library/foo';
    expect(redactString(input)).toBe(input);
  });
});

describe('PII pattern: GCP project numbers', () => {
  it('redacts URL-anchored projects/<number>', () => {
    const input = 'GET https://cloudresourcemanager.googleapis.com/v1/projects/123456789012';
    const out = redactStringForLog(input);
    expect(out).toContain('projects/[gcp-project-number]');
    expect(out).not.toContain('123456789012');
  });

  it('redacts a bare 10-12 digit project number on a gcloud line', () => {
    const input = 'gcloud config set project 987654321098';
    const out = redactStringForLog(input);
    expect(out).toContain('[gcp-project-number]');
    expect(out).not.toContain('987654321098');
  });

  it('does not redact a 10-12 digit number on a non-GCP line', () => {
    const input = 'transaction id 123456789012 completed';
    expect(redactStringForLog(input)).toContain('123456789012');
  });

  it('credential-only redactString does NOT touch project numbers', () => {
    const input = 'projects/123456789012';
    expect(redactString(input)).toBe(input);
  });
});

describe('PII pattern: JWT identity claims', () => {
  it('redacts a loose `sub` claim value', () => {
    const input = '{"sub":"114215298765432109876","email":"x@y.com"}';
    const out = redactStringForLog(input);
    expect(out).toContain('"sub":"[jwt-claim]"');
    expect(out).not.toContain('114215298765432109876');
  });

  it('redacts `iss` and `aud` claim values', () => {
    const input = '{"iss":"https://accounts.google.com","aud":"my-client.apps.googleusercontent.com"}';
    const out = redactStringForLog(input);
    expect(out).toContain('"iss":"[jwt-claim]"');
    expect(out).toContain('"aud":"[jwt-claim]"');
    expect(out).not.toContain('accounts.google.com');
    expect(out).not.toContain('my-client.apps.googleusercontent.com');
  });

  it('credential-only redactString does NOT touch JWT claims', () => {
    const input = '{"sub":"1234567890"}';
    expect(redactString(input)).toBe(input);
  });
});
