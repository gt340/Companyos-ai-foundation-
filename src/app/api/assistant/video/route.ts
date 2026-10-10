// src/app/api/assistant/video/route.ts
// Streams a Veo-generated video to a signed-in user so they can preview it in
// the browser. The Gemini file is fetched server-side with GEMINI_API_KEY, so
// the key never reaches the browser. Only a short file id is accepted (never
// a URL), so this cannot be used to fetch arbitrary addresses.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse("Please sign in first.", { status: 401 });
  }

  const fileId = new URL(req.url).searchParams.get("f") ?? "";
  if (!FILE_ID_PATTERN.test(fileId)) {
    return new NextResponse("Invalid video id.", { status: 400 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return new NextResponse("Video previews are not configured.", { status: 500 });
  }

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/files/${fileId}:download?alt=media`,
    { headers: { "x-goog-api-key": key }, redirect: "follow" }
  );
  if (!upstream.ok) {
    return new NextResponse(
      "That video could not be found. Generated videos expire after about 2 days.",
      { status: upstream.status === 404 ? 404 : 502 }
    );
  }

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  const total = bytes.length;

  const baseHeaders: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  // Browsers (especially on mobile) request video in byte ranges.
  const range = req.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      let start: number;
      let end: number;
      if (match[1] === "" && match[2] !== "") {
        // suffix range: the last N bytes
        const suffix = Number(match[2]);
        start = Math.max(total - suffix, 0);
        end = total - 1;
      } else {
        start = match[1] === "" ? 0 : Number(match[1]);
        end = match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
      }

      if (start > end || start >= total) {
        return new NextResponse(null, {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
        });
      }

      const chunk = bytes.slice(start, end + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(chunk.length),
        },
      });
    }
  }

  return new NextResponse(bytes, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
}
