import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const { response, userId } = await request.json();

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: challengeRow } = await admin
    .from("webauthn_challenges")
    .select("*")
    .eq("userId", userId)
    .eq("type", "authentication")
    .gt("expiresAt", new Date().toISOString())
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challengeRow) {
    return NextResponse.json({ error: "Sign-in session expired — please try again." }, { status: 400 });
  }

  const { data: passkey } = await admin
    .from("passkeys")
    .select("*")
    .eq("credentialId", response.id)
    .eq("userId", userId)
    .maybeSingle();

  if (!passkey) {
    return NextResponse.json({ error: "Passkey not recognized" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const rpID = new URL(request.url).hostname;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: passkey.credentialId,
        credentialPublicKey: Buffer.from(passkey.publicKey, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports ?? undefined,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 400 }
    );
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "Passkey verification failed" }, { status: 400 });
  }

  // Update the stored counter (replay-attack protection) and last-used timestamp
  await admin
    .from("passkeys")
    .update({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() })
    .eq("id", passkey.id);

  await admin.from("webauthn_challenges").delete().eq("id", challengeRow.id);

  // Generate a real magic-link-style token and exchange it for a session,
  // since there's no password to sign in with here.
  const { data: userRow } = await admin.auth.admin.getUserById(userId);
  if (!userRow.user?.email) {
    return NextResponse.json({ error: "Account has no email on file" }, { status: 400 });
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userRow.user.email,
  });

  if (linkError || !linkData) {
    return NextResponse.json({ error: "Couldn't complete sign-in" }, { status: 500 });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  const { error: verifyOtpError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });

  if (verifyOtpError) {
    return NextResponse.json({ error: "Couldn't complete sign-in" }, { status: 500 });
  }

  return NextResponse.json({ verified: true });
    }
