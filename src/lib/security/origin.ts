/** Validate that a browser mutation request originated from this exact origin. */
export function isSameOriginRequest(requestUrl: string, originHeader: string | null): boolean {
  if (!originHeader) return false;

  try {
    const requestOrigin = new URL(requestUrl).origin;
    const suppliedOrigin = new URL(originHeader).origin;
    return suppliedOrigin === requestOrigin;
  } catch {
    return false;
  }
}
