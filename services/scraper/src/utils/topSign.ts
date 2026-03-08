import crypto from "crypto";

type TopSignMethod = "md5" | "hmac";

function formatTopTimestamp(date: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function topTimestampUTC8(now = new Date()): string {
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return formatTopTimestamp(utc8);
}

export function signTopParams(
  params: Record<string, string>,
  secret: string,
  method: TopSignMethod = "md5"
): string {
  const keys = Object.keys(params)
    .filter((key) => key !== "sign" && key !== "image")
    .sort();

  const base = keys.map((key) => `${key}${params[key]}`).join("");

  if (method === "hmac") {
    return crypto.createHmac("md5", secret).update(base, "utf8").digest("hex").toUpperCase();
  }

  const signStr = `${secret}${base}${secret}`;
  return crypto.createHash("md5").update(signStr, "utf8").digest("hex").toUpperCase();
}
