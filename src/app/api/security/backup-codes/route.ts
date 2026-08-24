import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";

function generateCode() {
  // 8-character alphanumeric, grouped for readability e.g. "A3F9-K2QZ"
  const raw = randomBytes(4).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export async function POST() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // No-op: this route doesn't need to mutate the session cookie.
        },
      },
    }
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const codes = Array.from({ length: 8 }, generateCode);
  const hashed = codes.map(hashCode);

  const { error: upsertError } = await supabase
    .from("user_security")
    .upsert(
      {
        userId: user.id,
        backupCodes: hashed,
        twoFactorEnabled: true,
        twoFactorVerifiedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "userId" }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  // Return plaintext codes once — they can never be retrieved again after this.
  return NextResponse.json({ codes });
  }
