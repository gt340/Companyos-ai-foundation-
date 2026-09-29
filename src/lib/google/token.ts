import { prisma } from "@/lib/prisma";

// The one place every future Gmail/Calendar/Drive tool gets a usable
// access token from — auto-refreshes if it's expired or about to expire,
// so no tool has to duplicate this logic or ever call Google with a
// stale token. Returns null if the user hasn't connected Google at all.
export async function getValidGoogleAccessToken(userId: string): Promise<string | null> {
  const connection = await prisma.googleConnection.findUnique({ where: { userId } });
  if (!connection) return null;

  // 60s buffer so a token that's about to expire mid-request still gets
  // refreshed proactively rather than failing partway through a call.
  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return connection.accessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: connection.refreshToken,
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
    data: { accessToken: data.access_token, expiresAt },
  });

  return data.access_token as string;
}
