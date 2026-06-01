import { db } from "@/utils/supabase/server";
import { createSign, createHmac, createHash, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { env } from "@/app/env";
import { toGmt7OffsetISOString } from "@/app/lib/timezone";

// ─── URL helpers ──────────────────────────────────────────────────────────────

const SANDBOX_BASE = "https://tst.yokke.co.id:8280/qrissnapmpm/1.0.11";
const PROD_BASE    = "https://api.yokke.co.id:7778";

function getBase() {
    return env.yokkeIsProduction ? PROD_BASE : SANDBOX_BASE;
}

const TOKEN_PATH    = "/qr/v2.0/access-token/b2b";
const GENERATE_PATH = "/v2.0/qr/qr-mpm-generate";

function getTokenUrl()    { return `${getBase()}${TOKEN_PATH}`; }
function getGenerateUrl() { return `${getBase()}${GENERATE_PATH}`; }

// ─── Timestamp ────────────────────────────────────────────────────────────────

function getTimestamp(): string {
    return toGmt7OffsetISOString();
}

// ─── Access token ─────────────────────────────────────────────────────────────

/**
 * Signature for access-token endpoint:
 *   SHA256withRSA(privateKey, X-CLIENT-KEY + "|" + X-TIMESTAMP)
 */
function buildTokenSignature(clientKey: string, timestamp: string): string {
    const privateKey = env.yokkePrivateKey!;
    const stringToSign = `${clientKey}|${timestamp}`;
    const signer = createSign("SHA256");
    signer.update(stringToSign);
    return signer.sign(privateKey, "base64");
}

async function getAccessToken(): Promise<string> {
    const clientKey = env.yokkeClientKey!;
    const timestamp = getTimestamp();
    const signature = buildTokenSignature(clientKey, timestamp);

    const res = await fetch(getTokenUrl(), {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "X-CLIENT-KEY":  clientKey,
            "X-TIMESTAMP":   timestamp,
            "X-SIGNATURE":   signature,
            "X-PLATFORM":    "PORTAL",
        },
        body: JSON.stringify({ grantType: "client_credentials" }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[yokke] access token error:", err);
        throw new Error("Failed to get Yokke access token");
    }

    const data = await res.json();
    console.log("[yokke] access token obtained");
    return data.accessToken as string;
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
    const bodyHash = createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex")
        .toLowerCase();

    const stringToSign = [method, endpointPath, accessToken, bodyHash, timestamp].join(":");
    return createHmac("sha512", env.yokkeClientSecret!).update(stringToSign).digest("base64");
}

// ─── Partner reference number ─────────────────────────────────────────────────

/**
 * Generates a 15-digit numeric partnerReferenceNo from the current timestamp
 * plus a 2-digit random suffix.
 */
function generatePartnerRef(): string {
    const ts = Date.now().toString(); // 13 digits
    const rand = Math.floor(Math.random() * 100).toString().padStart(2, "0");
    return (ts + rand).slice(-15);
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
    boothid: string,
    uuid: string,
): Promise<void> {
    const supabase = await db();
    const { error } = await supabase
        .from("yokke_pending_payments")
        .insert({
            partner_reference_no: partnerReferenceNo,
            yokke_reference_no:   yokkeReferenceNo,
            booth_id:             boothid,
            uuid:                 uuid,
        });
    if (error) {
        console.error("[yokke] Failed to store pending payment:", error);
    }
}

// ─── QR generation ────────────────────────────────────────────────────────────

async function generateQR(boothid: string, uuid: string): Promise<YokkeQRResponse> {
    const accessToken       = await getAccessToken();
    const timestamp         = getTimestamp();
    const partnerRef        = generatePartnerRef();
    const externalId        = Date.now().toString().padStart(15, "0");
    const price             = await getPriceByBoothId(boothid);
    const priceStr          = `${price}.00`;

    const body: YokkeQRRequest = {
        merchantId:           env.yokkeMerchantId!,
        terminalId:           env.yokkeTerminalId!,
        partnerReferenceNo:   partnerRef,
        amount:               { value: priceStr, currency: "IDR" },
        feeAmount:            { value: "0.00",   currency: "IDR" },
    };

    const signature = buildApiSignature("POST", GENERATE_PATH, accessToken, body, timestamp);

    console.log("[yokke] generating QR for booth:", boothid, "partnerRef:", partnerRef);

    const res = await fetch(getGenerateUrl(), {
        method: "POST",
        headers: {
            "Content-Type":   "application/json",
            "Authorization":  `Bearer ${accessToken}`,
            "X-TIMESTAMP":    timestamp,
            "X-SIGNATURE":    signature,
            "X-EXTERNAL-ID":  externalId,
            "X-PARTNER-ID":   env.yokkePartnerId!,
            "CHANNEL-ID":     env.yokkeChannelId ?? "02",
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[yokke] QR generate error:", err);
        throw new Error(err.responseMessage ?? "Failed to generate Yokke QR");
    }

    const data: YokkeQRResponse = await res.json();
    console.log("[yokke] QR generated, referenceNo:", data.referenceNo);

    // Persist the mapping so the notify handler can recover boothid + uuid
    await storePendingPayment(partnerRef, data.referenceNo ?? null, boothid, uuid);

    return { ...data, partnerReferenceNo: partnerRef };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
    const split   = request.url.split("/");
    const boothid = split[split.length - 2];
    const uuid    = randomUUID();

    try {
        const data = await generateQR(boothid, uuid);
        return NextResponse.json({ success: true, data: { ...data, uuid } });
    } catch (error) {
        console.error("[yokke] POST error:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 400 });
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MoneyField = { value: string; currency: string };

type YokkeQRRequest = {
    merchantId:         string;
    terminalId:         string;
    partnerReferenceNo: string;
    amount:             MoneyField;
    feeAmount:          MoneyField;
};

type YokkeQRResponse = {
    responseCode:       string;
    responseMessage:    string;
    referenceNo?:       string;
    partnerReferenceNo: string;
    qrContent?:         string;
    terminalId?:        string;
    additionalInfo?:    { merchantId: string };
};
