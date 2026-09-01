/**
 * Shared constant names of the DSH credential records this plugin reads by
 * default (the `s2ApiKeyRef` / `astaApiKeyRef` settings carry a record-name
 * reference; when empty, these defaults are the records resolved). Defined in a
 * dependency-free module so the host (settings/index) AND the client card
 * (controller) share one spelling — renaming a record updates every site.
 * @module dsh-scholar-find/refs
 */

/** Default DSH credential record name for the Semantic Scholar API key. */
export const DEFAULT_S2_KEY_REF = 'S2_API_KEY'
/** Default DSH credential record name for the Ai2 Asta corpus MCP key. */
export const DEFAULT_ASTA_KEY_REF = 'ASTA_API_KEY'
/** Default DSH credential record name for the Sciverse Open Platform token. */
export const DEFAULT_SCIVERSE_KEY_REF = 'SCIVERSE_API_TOKEN'

/**
 * Trim a resolved credential value before use. API keys/tokens must not carry
 * surrounding whitespace (a stored `" s2k-..."` would be sent verbatim);
 * whitespace-only values degrade to undefined (fail-closed to anonymous).
 */
export function cleanCredentialValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}