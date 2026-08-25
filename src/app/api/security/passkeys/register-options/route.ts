import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";

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

  const { data: existingPasskeys } = await supabase
    .from("passkeys")
    .select("credentialId")
    .eq("userId", user.id);

  const rpID = new URL(request.url).hostname;

  const options = await generateRegistrationOptions({
    rpName: "CompanyOS",
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email ?? user.id,
    attestationType: "none",
    excludeCredentials: (existingPasskeys ?? []).map((p) => ({
      id: p.credentialId,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  // Clear old unused challenges for this user, then store the new one
  await supabase.from("webauthn_challenges").delete().eq("userId", user.id).eq("type", "registration");
  await supabase.from("webauthn_challenges").insert({
    userId: user.id,
    challenge: options.challenge,
    type: "registration",
  });

  return NextResponse.json(options);
    }
