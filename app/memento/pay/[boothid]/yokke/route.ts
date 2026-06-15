import { db } from "@/utils/supabase/server";
import { createSign, createHmac, createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { env } from "@/app/env";

// ─── URL helpers ──────────────────────────────────────────────────────────────

const SANDBOX_BASE = "https://tst.yokke.co.id:7778";
const PROD_BASE = "https://api.yokke.co.id:7778";

function getBase() {
    return env.yokkeIsProduction ? PROD_BASE : SANDBOX_BASE;
}

const TOKEN_PATH = "/qr/v2.0/access-token/b2b";
const GENERATE_PATH = "/v2.0/qr/qr-mpm-generate";

function getTokenUrl() { return `${getBase()}${TOKEN_PATH}`; }
function getGenerateUrl() { return `${getBase()}${GENERATE_PATH}`; }

// ─── Timestamp (WIB / GMT+7) ──────────────────────────────────────────────────

function getTimestamp(): string {
    const now = new Date();
    // Shift to WIB (UTC+7) by adding 7 hours worth of ms
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    // Format as ISO-like string using the shifted UTC values
    const y = wib.getUTCFullYear();
    const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
    const d = String(wib.getUTCDate()).padStart(2, "0");
    const H = String(wib.getUTCHours()).padStart(2, "0");
    const M = String(wib.getUTCMinutes()).padStart(2, "0");
    const S = String(wib.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${d}T${H}:${M}:${S}+07:00`;
}

// ─── Access token ─────────────────────────────────────────────────────────────
function buildTokenSignature(clientKey: string, timestamp: string): string {
    const privateKey = env.yokkePrivateKey!;
    const stringToSign = `${clientKey}|${timestamp}`;
    console.log("[yokke] Building token signature with stringToSign:", stringToSign);
    try {
        const signer = createSign("SHA256");
        signer.update(stringToSign);
        const signature = signer.sign(privateKey, "base64");
        const sigBytes = Buffer.from(signature, "base64").length;
        console.log("[yokke] Token signature generated:", {
            encoding: "base64",
            signatureBase64Length: signature.length,
            signatureRawBytes: sigBytes,
            keyBits: sigBytes * 8,
            signature,
        });
        return signature;
    } catch (e) {
        console.error("[yokke] Error generating token signature (RSA sign failed):", e);
        throw e;
    }
}

// ─── Token cache (reuse for up to 50 min) ─────────────────────────────────────

const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
        console.log("[yokke] Using cached access token (expires in", Math.round((cachedToken.expiresAt - Date.now()) / 1000), "s)");
        return cachedToken.token;
    }

    const clientKey = env.yokkeClientKey!;
    const timestamp = getTimestamp();
    const signature = buildTokenSignature(clientKey, timestamp);
    const url = getTokenUrl();

    const headers = {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": clientKey || "",
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        "X-PLATFORM": "PORTAL",
    };
    console.log("[yokke] Access token request headers:", headers);

    console.log("[yokke] Requesting access token from URL:", url);
    let res;
    try {
        res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ grantType: "client_credentials" }),
        });
    } catch (fetchErr) {
        console.error("[yokke] Access token fetch request failed (network error):", fetchErr);
        throw fetchErr;
    }

    if (!res.ok) {
        const resText = await res.text().catch(() => "");
        let errJson: Record<string, unknown> = {};
        try {
            errJson = JSON.parse(resText);
        } catch {}
        console.error(`[yokke] Access token error: HTTP status ${res.status} (${res.statusText}). Response:`, errJson || resText);
        throw new Error(`Failed to get Yokke access token (HTTP ${res.status})`);
    }

    const data = await res.json().catch(() => ({}));
    if (!data.accessToken) {
        console.error("[yokke] Access token response did not contain accessToken:", data);
        throw new Error("Access token missing in Yokke response");
    }
    console.log("[yokke] Access token successfully obtained:", data.accessToken.substring(0, 10) + "...");

    // Cache the token
    cachedToken = { token: data.accessToken as string, expiresAt: Date.now() + TOKEN_TTL_MS };
    return cachedToken.token;
}

// ─── API call signature (HMAC-SHA512) ─────────────────────────────────────────

/**
 * Symmetric signature for API calls (generate, inquiry, etc.):
 *   Base64(HMAC_SHA512(clientSecret, stringToSign))
 *   stringToSign = METHOD + ":" + endpointPath + ":" + accessToken
 *                + ":" + Lowercase(HexEncode(SHA-256(minify(body))))
 *                + ":" + timestamp
 */
function buildApiSignature(
    method: string,
    endpointPath: string,
    accessToken: string,
    body: object,
    timestamp: string,
): string {
    const bodyStr = JSON.stringify(body);
    const bodyHash = createHash("sha256")
        .update(bodyStr)
        .digest("hex")
        .toLowerCase();

    const stringToSign = [method, endpointPath, accessToken, bodyHash, timestamp].join(":");
    console.log("[yokke] Building API signature:", {
        method,
        endpointPath,
        accessTokenSummary: `${accessToken.substring(0, 10)}...`,
        bodyStr,
        bodyHash,
        timestamp,
        stringToSign
    });

    try {
        const signature = createHmac("sha512", env.yokkeClientSecret!)
            .update(stringToSign)
            .digest("base64");
        console.log("[yokke] API signature generated successfully");
        return signature;
    } catch (e) {
        console.error("[yokke] Error generating API signature (HMAC failed):", e);
        throw e;
    }
}

// ─── Unique reference generators ────────────────────────────────────────────

/**
 * Returns today's date as YYYYMMDD (8 digits, WIB timezone).
 */
function todayPrefix(): string {
    return new Date()
        .toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" })
        .split("/")
        .reverse()
        .join("");
}

/**
 * Generates a unique partnerReferenceNo (max 20 chars, numeric):
 *   YYYYMMDD (8) + millis-last-5 (5) + random-4 (4) + random-3 (3) = 20 chars
 * Unique within a day because of millis + random suffix.
 */
function generatePartnerRef(): string {
    const date = todayPrefix();
    const millis = (Date.now() % 100000).toString().padStart(5, "0");
    const rand = Math.floor(Math.random() * 10000000).toString().padStart(7, "0");
    return date + millis + rand;
}

/**
 * Generates a unique X-EXTERNAL-ID (max 15 chars, numeric):
 *   YYYYMMDD (8) + millis-last-4 (4) + random-3 (3) = 15 chars
 */
function generateExternalId(): string {
    const date = todayPrefix();
    const millis = (Date.now() % 10000).toString().padStart(4, "0");
    const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
    return date + millis + rand;
}

// ─── Price lookup ─────────────────────────────────────────────────────────────

async function getPriceByBoothId(boothid: string): Promise<number> {
    const supabase = await db();
    const { data, error } = await supabase
        .from("booth")
        .select("price")
        .eq("id", boothid)
        .single();
    if (error || !data) {
        console.warn(`[yokke] No price found for booth ${boothid}, using default`);
        return 10000;
    }
    return data.price;
}

// ─── Pending payment record ───────────────────────────────────────────────────

async function storePendingPayment(
    partnerReferenceNo: string,
    yokkeReferenceNo: string | null,
    externalId: string,
    boothid: string,
    uuid: string,
): Promise<void> {
    const supabase = await db();
    console.log("[yokke] Storing pending payment in database:", {
        partnerReferenceNo,
        yokkeReferenceNo,
        externalId,
        boothid,
        uuid,
    });
    const { error } = await supabase
        .from("yokke_pending_payments")
        .insert({
            partner_reference_no: partnerReferenceNo,
            yokke_reference_no: yokkeReferenceNo,
            external_id: externalId,
            booth_id: boothid,
            uuid: uuid,
        });
    if (error) {
        console.error("[yokke] Failed to store pending payment in Supabase:", error);
    } else {
        console.log("[yokke] Pending payment stored successfully in Supabase");
    }
}

// ─── QR generation ────────────────────────────────────────────────────────────

async function generateQR(boothid: string, uuid: string): Promise<YokkeQRResponse> {
    console.log("[yokke] Starting QR generation process for booth:", boothid, "uuid:", uuid);

    // Validate environment variables first
    const requiredEnv = {
        yokkeMerchantId: env.yokkeMerchantId,
        yokkeTerminalId: env.yokkeTerminalId,
        yokkePartnerId: env.yokkePartnerId,
        yokkeClientKey: env.yokkeClientKey,
        yokkePrivateKeyExists: !!env.yokkePrivateKey,
        yokkeClientSecretExists: !!env.yokkeClientSecret,
    };
    console.log("[yokke] Checking environment variables:", requiredEnv);

    if (!env.yokkeMerchantId || !env.yokkeTerminalId || !env.yokkePartnerId || !env.yokkeClientKey || !env.yokkePrivateKey || !env.yokkeClientSecret) {
        throw new Error("Missing required Yokke environment variables");
    }

    const accessToken = await getAccessToken();
    const timestamp = getTimestamp();
    const partnerRef = generatePartnerRef();
    const externalId = generateExternalId();
    const price = await getPriceByBoothId(boothid);
    const priceStr = `${price}.00`;
    console.log(`[yokke] Pricing for QR generation: ${price} (amount: ${priceStr})`);

    const body: YokkeQRRequest = {
        partnerReferenceNo: partnerRef,
        amount: { value: priceStr, currency: "IDR" },
        feeAmount: { value: priceStr, currency: "IDR" },
        merchantId: env.yokkeMerchantId,
        terminalId: env.yokkeTerminalId,
    };

    const signature = buildApiSignature("POST", GENERATE_PATH, accessToken, body, timestamp);
    const url = getGenerateUrl();

    const loggedHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken.substring(0, 10)}...`,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        "X-EXTERNAL-ID": externalId,
        "X-PARTNER-ID": env.yokkePartnerId,
        "CHANNEL-ID": env.yokkeChannelId ?? "02",
    };

    console.log("[yokke] Sending QR Generate request details:", {
        url,
        headers: loggedHeaders,
        body,
    });

    let res;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
                "X-TIMESTAMP": timestamp,
                "X-SIGNATURE": signature,
                "X-EXTERNAL-ID": externalId,
                "X-PARTNER-ID": env.yokkePartnerId,
                "CHANNEL-ID": env.yokkeChannelId ?? "02",
            },
            body: JSON.stringify(body),
        });
    } catch (fetchErr) {
        console.error("[yokke] QR generate fetch request failed (network error):", fetchErr);
        throw fetchErr;
    }

    if (!res.ok) {
        const resText = await res.text().catch(() => "");
        let errJson: { responseMessage?: string } = {};
        try {
            errJson = JSON.parse(resText);
        } catch {}
        console.error(`[yokke] QR generate error: HTTP status ${res.status} (${res.statusText}). Response:`, errJson || resText);
        throw new Error(errJson.responseMessage ?? `Failed to generate Yokke QR (HTTP ${res.status})`);
    }

    const data: YokkeQRResponse = await res.json().catch(() => ({}));
    console.log("[yokke] QR API response received successfully:", data);

    if (!data.qrContent) {
        console.warn("[yokke] QR API response is missing qrContent field:", data);
    }

    await storePendingPayment(partnerRef, data.referenceNo ?? null, externalId, boothid, uuid);

    return { ...data, partnerReferenceNo: partnerRef };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
    const split = request.url.split("/");
    const boothid = split[split.length - 2];
    const uuid = randomUUID();

    console.log(`[yokke] POST request received for boothid: ${boothid}, generated request uuid: ${uuid}`);

    try {
        const data = await generateQR(boothid, uuid);
        console.log(`[yokke] POST request succeeded for boothid: ${boothid}, uuid: ${uuid}`);
        return NextResponse.json({ success: true, data: { ...data, uuid } });
    } catch (error) {
        console.error(`[yokke] POST request failed for boothid: ${boothid}, uuid: ${uuid}. Error:`, error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 400 });
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MoneyField = { value: string; currency: string };

type YokkeQRRequest = {
    merchantId: string;
    terminalId: string;
    partnerReferenceNo: string;
    amount: MoneyField;
    feeAmount: MoneyField;
};

type YokkeQRResponse = {
    responseCode: string;
    responseMessage: string;
    referenceNo?: string;
    partnerReferenceNo: string;
    qrContent?: string;
    terminalId?: string;
    additionalInfo?: { merchantId: string };
};
