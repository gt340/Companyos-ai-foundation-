import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { response, deviceName } = body;

  const { data: challengeRow } = await supabase
    .from("webauthn_challenges")
    .select("*")
    .eq("userId", user.id)
    .eq("type", "registration")
    .gt("expiresAt", new Date().toISOString())
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challengeRow) {
    return NextResponse.json({ error: "Registration session expired — please try again." }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const rpID = new URL(request.url).hostname;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 400 }
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Passkey verification failed" }, { status: 400 });
  }

  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;

  const { error: insertError } = await supabase.from("passkeys").insert({
    userId: user.id,
    credentialId: credentialID,
    publicKey: Buffer.from(credentialPublicKey).toString("base64url"),
    counter,
    deviceName: deviceName || "Passkey",
    transports: response.response?.transports ?? [],
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Clean up the used challenge
  await supabase.from("webauthn_challenges").delete().eq("id", challengeRow.id);

  return NextResponse.json({ verified: true });
      }
