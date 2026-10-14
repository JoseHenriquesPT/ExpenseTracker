const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Returns the URL when it is a safe absolute link (http, https or mailto), or
 * null for anything else — javascript:, data:, protocol-relative, relative or
 * plain garbage. Used before storing planned-expense links and before
 * rendering them as anchors, so a hostile URL can never become an href.
 */
export function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  // Browsers strip tabs/newlines before parsing ("java\nscript:"), so reject
  // any control character outright.
  if (/[\u0000-\u001f\u007f]/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol) ? url : null;
}
