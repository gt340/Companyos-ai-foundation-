import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken, encryptionEnabled, isEncrypted } from "@/lib/security/token-crypto";

const RECONNECT_MESSAGE =
  "The stored Google connection could not be read. Please disconnect and reconnect your Google account at /integrations.";

function openToken(stored: string): string {
  try {
    return decryptToken(stored);
  } catch {
    throw new Error(RECONNECT_MESSAGE);
  }
}

// The one place every future Gmail/Calendar/Drive tool gets a usable
// access token from — auto-refreshes if it's expired or about to expire,
// so no tool has to duplicate this logic or ever call Google with a
// stale token. Returns null if the user hasn't connected Google at all.
//
// Tokens are stored encrypted (see src/lib/security/token-crypto.ts) once
// TOKEN_ENCRYPTION_KEY is configured; older plain-text rows keep working and
// are upgraded to encrypted storage the first time they are used.
export async function getValidGoogleAccessToken(userId: string): Promise<string | null> {
  const connection = await prisma.googleConnection.findUnique({ where: { userId } });
  if (!connection) return null;

  const accessToken = openToken(connection.accessToken);
  const refreshToken = openToken(connection.refreshToken);

  // Upgrade legacy plain-text tokens to encrypted storage (only when a key is set).
  if (
    encryptionEnabled() &&
    (!isEncrypted(connection.accessToken) || !isEncrypted(connection.refreshToken))
  ) {
    await prisma.googleConnection.update({
      where: { userId },
      data: {
        accessToken: encryptToken(accessToken),
        refreshToken: encryptToken(refreshToken),
      },
    });
  }

  // 60s buffer so a token that's about to expire mid-request still gets
  // refreshed proactively rather than failing partway through a call.
  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return accessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description ?? data.error ?? "Failed to refresh the Google access token — the user may need to reconnect their Google account."
    );
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await prisma.googleConnection.update({
    where: { userId },
    data: { accessToken: encryptToken(data.access_token as string), expiresAt },
  });

  return data.access_token as string;
}
