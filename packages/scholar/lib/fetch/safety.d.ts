/**
 * Download-layer safety for the paper_fetch tools: SSRF gate, `%PDF` magic
 * check, size cap, and a redirect walk that re-validates every hop.
 * Independent TypeScript implementation of the documented safety
 * requirements (no code from the reference repos).
 * @module dsh-scholar/fetch-safety
 */
/** Reasons one URL was refused. */
export type SafetyReason = 'malformed_url' | 'scheme_not_allowed' | 'port_not_allowed' | 'empty_host' | 'blocked_host' | 'private_ip' | 'ipv6_literal' | 'dns_error' | 'dns_private_ip';
/** Syntactic gate: scheme, port, host literal, blocklist. DNS-independent. */
export declare function isSafeUrl(url: string): {
    ok: boolean;
    reason?: SafetyReason;
};
/** Private/loopback/link-local/reserved IPv4 classification. */
export declare function isPrivateIPv4(ip: string): boolean;
/** DNS-resolution gate: every resolved address must be public. */
export declare function hostAddrsSafe(host: string): Promise<{
    ok: boolean;
    reason?: SafetyReason;
}>;
/** Full pre-fetch gate: syntax + DNS resolution. */
export declare function urlFetchAllowed(url: string): Promise<{
    ok: boolean;
    reason?: SafetyReason;
}>;
/** Max redirect hops we will follow until we re-validate. */
export declare const MAX_REDIRECTS = 5;
/**
 * Walk redirects manually (fetch `redirect: 'manual'`), validating every hop
 * through the full gate, and return the terminal response. `checkDns` can be
 * disabled in tests to keep them hermetic.
 */
export declare function fetchWithRedirects(url: string, init: RequestInit, opts?: {
    maxRedirects?: number;
    checkDns?: boolean;
}): Promise<Response>;
/** True when the bytes start with the `%PDF` magic marker. */
export declare function looksLikePdf(bytes: Uint8Array): boolean;
/** Read a response body up to `cap` bytes; null when it exceeds the cap. */
export declare function readBodyCapped(r: Response, cap: number, signal?: AbortSignal): Promise<Uint8Array | null>;
