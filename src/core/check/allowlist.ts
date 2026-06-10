/**
 * Recognized-pattern allowlist (PLAN.md Eng Hardening §1).
 *
 * CONFIRMED / ABSENT may ONLY be emitted for (category, predicate) pairs that
 * appear here AND for which the graph shows the relevant extractor rules ran.
 * Anything off this list resolves UNDETERMINED by construction — the explainer
 * reads "pattern not on the recognized-pattern allowlist".
 *
 * This is a versioned, documented artifact: the `ruleIds` are the extractor
 * rule ids whose presence (in node/edge provenance or in `graph.stats`) is the
 * evidence that the recognizing pass actually ran. Without that evidence the
 * checker cannot distinguish "searched and absent" from "never looked", so it
 * stays UNDETERMINED.
 */
import type { ClaimCategory, ClaimPredicate } from '../schema.js';

export interface AllowlistEntry {
  category: ClaimCategory;
  predicate: ClaimPredicate;
  /** Extractor rule ids whose presence proves the recognizing pass ran. */
  ruleIds: string[];
  description: string;
}

/**
 * Frozen, ordered allowlist. Widening the usefulness floor (PLAN.md §7 floor
 * precedence) means adding entries HERE — never relaxing the undetermined-bias
 * elsewhere.
 */
const ALLOWLIST: readonly AllowlistEntry[] = Object.freeze([
  {
    category: 'route',
    predicate: 'exists',
    ruleIds: ['routes/app-router-page', 'routes/app-router-handler'],
    description:
      'Next.js App Router route: app/**/page.tsx or app/**/route.ts with a METHOD export.',
  },
  {
    category: 'middleware',
    predicate: 'attached',
    ruleIds: ['middleware/matcher', 'middleware/guard-wrapper'],
    description:
      'middleware.ts attachment to a route via config.matcher or a recognized guard wrapper.',
  },
  {
    category: 'schema',
    predicate: 'exists',
    ruleIds: ['schema/prisma-model'],
    description: 'Prisma model → dbTable node parsed from schema.prisma.',
  },
  {
    category: 'schema',
    predicate: 'has-column',
    ruleIds: ['schema/prisma-field'],
    description: 'Prisma model field → dbColumn node + hasColumn edge.',
  },
  {
    category: 'env',
    predicate: 'reads',
    ruleIds: ['env/process-env-read'],
    description: 'process.env.NAME read site → envVar node + reads edge.',
  },
  {
    category: 'dep',
    predicate: 'installed',
    ruleIds: ['deps/package-json'],
    description: 'Dependency present in package.json (manifest parse).',
  },
  {
    category: 'wiring',
    predicate: 'wired',
    ruleIds: ['wiring/literal-url', 'wiring/resolved-url'],
    description:
      'Client call whose URL resolves (literal / constant / helper) to a defined route.',
  },
]);

export function getAllowlist(): AllowlistEntry[] {
  // Return a shallow copy so callers cannot mutate the frozen artifact.
  return ALLOWLIST.map((e) => ({ ...e, ruleIds: [...e.ruleIds] }));
}

/** Lookup an allowlist entry by (category, predicate); undefined if off-list. */
export function findAllowlistEntry(
  category: ClaimCategory,
  predicate: ClaimPredicate,
): AllowlistEntry | undefined {
  return ALLOWLIST.find(
    (e) => e.category === category && e.predicate === predicate,
  );
}
