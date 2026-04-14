// First-call confirmation-required response builder.
//
// When a destructive op is invoked without a `confirm` parameter, the tool
// returns a `confirmation_required` error envelope describing:
//   1. the human-readable warning (`message`)
//   2. the canonical phrase the user must type (`confirmation_phrase`)
//   3. the exact `next_call` Claude should make with `confirm: <phrase>`
//      embedded alongside the target arguments
//
// This builder is the single construction point for that response so the
// three pieces stay in sync (identical phrase in `confirmation_phrase` and
// `next_call.arguments.confirm`).
//
// Per plan.md Decision #5, no token is minted — the phrase itself is the
// defense, and it's a pure function of (op, target).

import { makeError, type ErrorEnvelope } from '@concierge/core/errors';

import {
  canonicalPhrase,
  type ConfirmationOp,
  type ConfirmationTargetMap,
} from './phrases.js';

/**
 * Map each confirmation op to the tool name Claude should call on the
 * follow-up invocation. `set_read_only_off` maps back to `set_read_only`
 * (the op distinguishes the `enabled: false` branch that needs confirmation
 * but the tool name is shared).
 */
const OP_TO_TOOL_NAME: Readonly<Record<ConfirmationOp, string>> = {
  remove_account: 'remove_account',
  factory_reset: 'factory_reset',
  set_read_only_off: 'set_read_only',
  drive_permissions_create_cross_domain: 'drive_permissions_create',
};

/**
 * Build the baseline `next_call.arguments` for each op.
 *
 * For `set_read_only_off`, we surface `enabled: false` explicitly so Claude
 * doesn't have to remember the semantics from the op name.
 */
function baseArgumentsFor<Op extends ConfirmationOp>(
  op: Op,
  target: ConfirmationTargetMap[Op],
): Record<string, unknown> {
  switch (op) {
    case 'remove_account': {
      const t = target as ConfirmationTargetMap['remove_account'];
      return { email: t.email };
    }
    case 'factory_reset': {
      return {};
    }
    case 'set_read_only_off': {
      const t = target as ConfirmationTargetMap['set_read_only_off'];
      return { account: t.account, enabled: false };
    }
    case 'drive_permissions_create_cross_domain': {
      const t = target as ConfirmationTargetMap['drive_permissions_create_cross_domain'];
      return { email: t.email };
    }
    default: {
      // Exhaustiveness guard — `op` is `never` here if the union is covered.
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

/**
 * Build the first-call `confirmation_required` error envelope.
 *
 * @param op      The destructive op being confirmed.
 * @param target  Target values used to render the canonical phrase.
 * @param warning Human-facing warning copy. Becomes `envelope.message`; callers
 *                are responsible for localization / tone. Must be non-empty.
 */
export function buildConfirmationRequiredResponse<Op extends ConfirmationOp>(
  op: Op,
  target: ConfirmationTargetMap[Op],
  warning: string,
): ErrorEnvelope {
  const phrase = canonicalPhrase(op, target);
  const toolName = OP_TO_TOOL_NAME[op];
  const args: Record<string, unknown> = {
    ...baseArgumentsFor(op, target),
    confirm: phrase,
  };

  return makeError({
    error_code: 'confirmation_required',
    message: warning,
    confirmation_phrase: phrase,
    next_call: {
      tool: toolName,
      arguments: args,
    },
  });
}
