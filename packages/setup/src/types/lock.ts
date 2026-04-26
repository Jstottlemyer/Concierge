// Single-instance lock file shape, written to ~/.config/concierge/setup.lock
// while the orchestrator is running. Used to detect concurrent runs.

export interface LockFile {
  pid: number;
  startedAt: string; // ISO-8601
  hostname: string;
  setupVersion: string;
}
