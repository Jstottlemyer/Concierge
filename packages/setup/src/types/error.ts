// Setup-orchestrator-specific error_code literals.
// NEW additions owned by @concierge/setup. Do NOT modify the @concierge/core
// ErrorCode union — that has its own ownership. The setup package re-uses
// `makeError` from core but registers its own error_code namespace via this
// type-only string literal union.

export type SetupErrorCode =
  | 'setup_lock_held'
  | 'tarball_sha_mismatch'
  | 'tarball_cosign_failed'
  | 'cosign_install_failed'
  | 'port_collision'
  | 'claude_target_missing'
  | 'verify_failed_after_retry'
  | 'placeholder_project_id'
  | 'account_mismatch'
  | 'unknown_flag'
  | 'gws_version_too_old'
  | 'admin_path_required'
  | 'oauth_browser_failed';
