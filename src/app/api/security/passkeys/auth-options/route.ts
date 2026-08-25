import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const { email } = await request.json();

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // This route runs before the user is signed in, so we need an admin-level
  // lookup to find their user id and existing passkeys from just their email.
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: userRow } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!userRow) {
    // Don't reveal whether the account exists — return generic empty options.
    return NextResponse.json({ error: "No passkey found for this account" }, { status: 404 });
  }

  const { data: passkeys } = await admin
    .from("passkeys")
    .select("credentialId, transports")
    .eq("userId", userRow.id);

  if (!passkeys || passkeys.length === 0) {
    return NextResponse.json({ error: "No passkey found for this account" }, { status: 404 });
  }

  const rpID = new URL(request.url).hostname;

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: passkeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports ?? undefined,
    })),
    userVerification: "preferred",
  });

  await admin.from("webauthn_challenges").delete().eq("userId", userRow.id).eq("type", "authentication");
  await admin.from("webauthn_challenges").insert({
    userId: userRow.id,
    challenge: options.challenge,
    type: "authentication",
  });

  return NextResponse.json({ options, userId: userRow.id });
}
