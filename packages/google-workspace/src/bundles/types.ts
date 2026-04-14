// Bundle + service type definitions.
//
// Per spec.md Data & State §Bundle membership and §Primary-bundle resolution.
// Canonical service identifiers are lowercase-hyphenated (e.g. `admin-reports`).
// Bundle identifiers are the six fixed keys of the `BUNDLES` record.

/** Lowercase-hyphenated service identifier matching spec.md canonical strings. */
export type Service =
  | 'gmail'
  | 'drive'
  | 'calendar'
  | 'docs'
  | 'sheets'
  | 'tasks'
  | 'forms'
  | 'chat'
  | 'meet'
  | 'people'
  | 'classroom'
  | 'slides'
  | 'script'
  | 'admin-reports'
  | 'events'
  | 'modelarmor';

/** One of the six scope bundles (spec.md §Bundle membership). */
export type BundleId =
  | 'productivity'
  | 'collaboration'
  | 'admin'
  | 'education'
  | 'creator'
  | 'automation';

/** A Google OAuth scope URL (e.g. `https://www.googleapis.com/auth/drive`). */
export type ScopeUrl = `https://www.googleapis.com/auth/${string}`;

/** A scope bundle: a display name, its member services, and the deduplicated union of their scope URLs. */
export interface BundleDef {
  readonly id: BundleId;
  readonly displayName: string;
  readonly services: readonly Service[];
  readonly scopes: readonly ScopeUrl[];
}
