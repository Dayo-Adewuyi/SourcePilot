import crypto from "crypto";

export type SigV4Input = {
  method: string;
  host: string;
  path: string;
  query: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  payload: string;
  headers: Record<string, string>;
  now?: Date;
};

function hash(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\..+/g, "");
  const amzDate = `${iso.slice(0, 8)}T${iso.slice(8, 14)}Z`;
  const dateStamp = iso.slice(0, 8);
  return { amzDate, dateStamp };
}

export function signSigV4(input: SigV4Input) {
  const now = input.now ?? new Date();
  const { amzDate, dateStamp } = toAmzDate(now);

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers)) {
    headers[key.toLowerCase()] = value;
  }
  headers.host = input.host;
  headers["x-amz-date"] = amzDate;

  const lowerKeys = Object.keys(headers).sort();

  const canonicalHeaders = lowerKeys
    .map((key) => `${key}:${headers[key].trim()}`)
    .join("\n");

  const signedHeaders = lowerKeys.join(";");
  const payloadHash = hash(input.payload);

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path || "/",
    input.query || "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${input.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: {
      ...headers,
      Authorization: authorization,
    },
    amzDate,
    authorization,
  };
}
