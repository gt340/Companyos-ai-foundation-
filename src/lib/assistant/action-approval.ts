import { createHmac, timingSafeEqual } from "crypto";

type ApprovalClaims = {
  sub: string;
  org: string;
  tool: string;
  args: unknown;
  exp: number;
  jti: string;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function signingKey(): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || Buffer.byteLength(key, "utf8") < 32) {
    throw new Error("Action approval signing is unavailable: TOKEN_ENCRYPTION_KEY must be configured with at least 32 bytes.");
  }
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function createActionApprovalToken(input: {
  userId: string;
  organizationId: string;
  tool: string;
  args: unknown;
}): string {
  const claims: ApprovalClaims = {
    sub: input.userId,
    org: input.organizationId,
    tool: input.tool,
    args: input.args,
    exp: Math.floor(Date.now() / 1000) + 5 * 60,
    jti: cryptoRandomId(),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function cryptoRandomId(): string {
  return require("crypto").randomUUID();
}

export function verifyActionApprovalToken(input: {
  token: unknown;
  userId: string;
  organizationId: string;
  tool: string;
  args: unknown;
}): { valid: boolean; jti?: string } {
  try {
    if (typeof input.token !== "string") return { valid: false };
    const [payload, suppliedSignature, extra] = input.token.split(".");
    if (!payload || !suppliedSignature || extra) return { valid: false };
    const expected = Buffer.from(sign(payload));
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return { valid: false };
    }
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ApprovalClaims;
    const valid =
      typeof claims.exp === "number" &&
      claims.exp >= Math.floor(Date.now() / 1000) &&
      claims.sub === input.userId &&
      claims.org === input.organizationId &&
      claims.tool === input.tool &&
      stable(claims.args) === stable(input.args);
    return valid ? { valid: true, jti: claims.jti } : { valid: false };
  } catch {
    return { valid: false };
  }
}
