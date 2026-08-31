import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export type ExtractResult = { text: string } | { error: string };

export async function extractFromPdf(buffer: Buffer): Promise<ExtractResult> {
  try {
    // Lazy-imported because pdf-parse touches the filesystem on module load
    // in a way that's awkward in some serverless bundlers.
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return { text: result.text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to parse PDF" };
  }
}

export async function extractFromWord(buffer: Buffer): Promise<ExtractResult> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to parse Word document" };
  }
}

export async function extractFromExcel(buffer: Buffer): Promise<ExtractResult> {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet);
      parts.push(`# Sheet: ${sheetName}\n${csv}`);
    }
    return { text: parts.join("\n\n") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to parse Excel file" };
  }
}

export async function extractFromPowerPoint(buffer: Buffer): Promise<ExtractResult> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
        const numB = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
        return numA - numB;
      });

    const parts: string[] = [];
    for (const [index, fileName] of slideFiles.entries()) {
      const xml = await zip.files[fileName]!.async("text");
      // Slide text lives inside <a:t>...</a:t> tags in the raw XML.
      const matches = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
      parts.push(`# Slide ${index + 1}\n${matches.join(" ")}`);
    }
    return { text: parts.join("\n\n") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to parse PowerPoint file" };
  }
}

export async function extractFromImage(buffer: Buffer, mimeType: string): Promise<ExtractResult> {
  try {
    const base64 = buffer.toString("base64");
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract and transcribe all text, labels, and meaningful visual content from this image. If it's a document or scan, transcribe it fully. If it's a diagram or photo, describe what it shows in detail.",
            },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
    });
    return { text: response.choices[0]?.message?.content ?? "" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to analyze image" };
  }
}

export async function extractFromAudioOrVideo(file: File): Promise<ExtractResult> {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    return { text: transcription.text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to transcribe audio/video" };
  }
}

export async function extractFromUrl(url: string): Promise<ExtractResult> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "CompanyOS-KnowledgeBase/1.0" } });
    if (!res.ok) return { error: `Couldn't fetch that URL (status ${res.status})` };

    const html = await res.text();
    // Strip script/style blocks, then all remaining tags, then collapse whitespace.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();

    return { text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch URL" };
  }
}

/**
 * Basic cleanup applied to any extracted text before chunking: collapses
 * excess whitespace and strips control characters that sometimes leak in
 * from PDF/Office extraction, without altering meaningful content.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
