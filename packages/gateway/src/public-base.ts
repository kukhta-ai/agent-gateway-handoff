/** A normalized public base URL used for GLA's externally reachable gateway paths. */
export interface PublicBase {
  /** Canonical URL string with no query or fragment. */
  readonly href: string;
  /** Scheme + host + optional port; WebAuthn expected-origin checks use only this value. */
  readonly origin: string;
  /** Empty for root deployments, otherwise a leading-slash path prefix with no trailing slash. */
  readonly pathPrefix: string;
}

/** A startup-safe validation error for an invalid `GLA_PUBLIC_BASE_URL`. */
export class PublicBaseUrlError extends Error {
  override readonly name = "PublicBaseUrlError";
}

/**
 * Parse and canonicalize `GLA_PUBLIC_BASE_URL`.
 *
 * The base URL is an operator contract, not a best-effort hint. Ambiguous paths are rejected so links, callbacks,
 * WebSocket URLs, and proxy routing cannot silently disagree about which public path is authoritative.
 */
export function parsePublicBaseUrl(raw: string): PublicBase {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw invalidPublicBase("expected an absolute http(s) URL with scheme and host");
  }

  const authority = raw.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?<authority>[^/?#]*)/)?.groups
    ?.authority;
  if (authority === undefined || authority.length === 0) {
    throw invalidPublicBase("expected a host");
  }
  if (authority.includes("@")) {
    throw invalidPublicBase("userinfo is not supported");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw invalidPublicBase("expected http or https scheme");
  }
  if (u.hostname.length === 0) {
    throw invalidPublicBase("expected a host");
  }
  if (u.search.length > 0) {
    throw invalidPublicBase("query strings are not supported");
  }
  if (u.hash.length > 0) {
    throw invalidPublicBase("fragments are not supported");
  }

  const rawPath = rawPathname(raw);
  validateCanonicalPath(rawPath);
  const pathPrefix = canonicalPathPrefix(u.pathname);
  const href = `${u.origin}${pathPrefix.length > 0 ? `${pathPrefix}/` : "/"}`;
  return { href, origin: u.origin, pathPrefix };
}

/**
 * Build a same-origin public path under `base` from an internal gateway route path.
 *
 * `routePath` must be root-relative and must not contain query/fragment components. Query parameters belong to
 * {@link publicUrl}, which keeps path joining and query encoding separate.
 */
export function publicPath(base: PublicBase, routePath: string): string {
  const route = normalizeRoutePath(routePath);
  if (base.pathPrefix.length === 0) {
    return route;
  }
  if (route === "/") {
    return `${base.pathPrefix}/`;
  }
  return `${base.pathPrefix}${route}`;
}

/** Build an absolute public URL under `base`, preserving the public path prefix exactly once. */
export function publicUrl(
  base: PublicBase | string,
  routePath: string,
  params: Readonly<Record<string, string>> = {},
): string {
  const parsed = typeof base === "string" ? parsePublicBaseUrl(base) : base;
  const u = new URL(publicPath(parsed, routePath), parsed.origin);
  for (const [key, value] of Object.entries(params)) {
    u.searchParams.set(key, value);
  }
  return u.toString();
}

/**
 * Translate an inbound request path into the gateway's internal root-shaped route path.
 *
 * A non-root public base supports both safe proxy styles:
 * - preserve-prefix proxying: the gateway receives `/base/enroll` and strips `/base`;
 * - strip-prefix proxying: the gateway receives `/enroll` with `X-Forwarded-Prefix: /base`.
 *
 * Unprefixed requests without the matching forwarded-prefix header are refused for non-root deployments, so a
 * subpath deployment does not accidentally publish both `/base/...` and `/...` when the gateway is exposed.
 */
export function internalPathForPublicRequest(
  base: PublicBase,
  requestPath: string,
  forwardedPrefix?: string,
  trustForwardedPrefix = false,
): string | undefined {
  const path = normalizeRoutePath(requestPath);
  if (base.pathPrefix.length === 0) {
    return path;
  }
  if (path === base.pathPrefix) {
    return "/";
  }
  if (path.startsWith(`${base.pathPrefix}/`)) {
    const stripped = path.slice(base.pathPrefix.length);
    return stripped.length > 0 ? stripped : "/";
  }
  if (trustForwardedPrefix && forwardedPrefixMatches(base, forwardedPrefix)) {
    return path;
  }
  return undefined;
}

function rawPathname(raw: string): string {
  const m = raw.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*(?<path>[^?#]*)?/);
  return m?.groups?.path ?? "";
}

function validateCanonicalPath(path: string): void {
  if (path.length === 0 || path === "/") {
    return;
  }
  if (!path.startsWith("/")) {
    throw invalidPublicBase("path must start with /");
  }
  if (path.includes("//")) {
    throw invalidPublicBase("path contains ambiguous duplicate slashes");
  }
  const lower = path.toLowerCase();
  if (/%2f|%5c/.test(lower)) {
    throw invalidPublicBase("encoded slash or backslash is ambiguous");
  }
  for (const segment of path.split("/")) {
    if (segment.length === 0) {
      continue;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalidPublicBase("path contains malformed percent encoding");
    }
    if (decoded === "." || decoded === "..") {
      throw invalidPublicBase("path contains dot-segment normalization ambiguity");
    }
    if (decoded.includes("/") || decoded.includes("\\")) {
      throw invalidPublicBase("path segment decodes to a separator");
    }
  }
}

function invalidPublicBase(reason: string): PublicBaseUrlError {
  return new PublicBaseUrlError(`invalid GLA_PUBLIC_BASE_URL (${reason})`);
}

function canonicalPathPrefix(pathname: string): string {
  if (pathname === "" || pathname === "/") {
    return "";
  }
  return pathname.replace(/\/+$/, "");
}

function normalizeRoutePath(routePath: string): string {
  if (!routePath.startsWith("/")) {
    throw new PublicBaseUrlError(`gateway route path "${routePath}" must start with /`);
  }
  if (routePath.includes("?") || routePath.includes("#")) {
    throw new PublicBaseUrlError(
      `gateway route path "${routePath}" must not include query or fragment`,
    );
  }
  return routePath.replace(/\/+$/, "") || "/";
}

function forwardedPrefixMatches(base: PublicBase, forwardedPrefix: string | undefined): boolean {
  if (forwardedPrefix === undefined || forwardedPrefix.length === 0) {
    return false;
  }
  const first = forwardedPrefix.split(",")[0]?.trim() ?? "";
  if (first.length === 0) {
    return false;
  }
  try {
    validateCanonicalPath(first);
    return canonicalPathPrefix(first) === base.pathPrefix;
  } catch {
    return false;
  }
}
