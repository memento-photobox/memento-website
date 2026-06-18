import { db } from "@/utils/supabase/server";
import { createHmac, createHash } from "crypto";
import { NextResponse } from "next/server";
import { env } from "@/app/env";
import { Memento } from "../../../types";
import { checkAndSendNoticePrint } from "../../notice-check";


const SANDBOX_BASE = "https://tst.yokke.co.id:8280/qrissnapmpm/1.0.11";
const PROD_BASE    = "https://api.yokke.co.id:7778";

const INQUIRY_PATH = "/v3.0/qr/qr-mpm-query";

function getInquiryUrl() {
    return env.yokkeIsProduction
        ? `${PROD_BASE}${INQUIRY_PATH}`
        : `${SANDBOX_BASE}${INQUIRY_PATH}`;
}

// ─── Timestamp (WIB / GMT+7) ──────────────────────────────────────────────────

function getTimestamp(): string {
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const y = wib.getUTCFullYear();
    const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
    const d = String(wib.getUTCDate()).padStart(2, "0");
    const H = String(wib.getUTCHours()).padStart(2, "0");
    const M = String(wib.getUTCMinutes()).padStart(2, "0");
    const S = String(wib.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${d}T${H}:${M}:${S}+07:00`;
}

// ─── API call signature (HMAC-SHA512) ─────────────────────────────────────────

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

// ─── QR Inquiry ───────────────────────────────────────────────────────────────

/**
 * Calls Yokke's inquiry endpoint to verify the transaction status.
 * Returns the inquiry response or throws on error.
 */
async function inquireTransaction(
    accessToken: string,
    originalReferenceNo: string,
    originalExternalId: string,
    originalTransactionDate: string,
): Promise<YokkeInquiryResponse> {
    const timestamp = getTimestamp();
    const externalId = Date.now().toString().padStart(15, "0");

    const body = {
        originalReferenceNo,
        originalExternalId,
        serviceCode: "47",
        merchantId: env.yokkeMerchantId!,
        additionalInfo: {
            originalTransactionDate,
            terminalId: env.yokkeTerminalId!,
        },
    };

    const signature = buildApiSignature("POST", INQUIRY_PATH, accessToken, body, timestamp);

    const res = await fetch(getInquiryUrl(), {
        method: "POST",
        headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${accessToken}`,
            "X-TIMESTAMP":   timestamp,
            "X-SIGNATURE":   signature,
            "X-EXTERNAL-ID": externalId,
            "X-PARTNER-ID":  env.yokkePartnerId!,
            "CHANNEL-ID":    env.yokkeChannelId ?? "02",
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[yokke] inquiry error:", err);
        throw new Error(err.responseMessage ?? "Inquiry failed");
    }

    return res.json() as Promise<YokkeInquiryResponse>;
}

// ─── Access token (re-used from generate route logic) ────────────────────────
// We import a small helper inline here to avoid circular deps.

import { createSign } from "crypto";

function buildTokenSignature(clientKey: string, timestamp: string): string {
    const signer = createSign("SHA256");
    signer.update(`${clientKey}|${timestamp}`);
    return signer.sign(env.yokkePrivateKey!, "base64");
}

const SANDBOX_TOKEN_URL = `${SANDBOX_BASE}/qr/v2.0/access-token/b2b`;
const PROD_TOKEN_URL    = `${PROD_BASE}/qr/v2.0/access-token/b2b`;

// ─── Token cache (reuse for up to 50 min) ─────────────────────────────────────

const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
        console.log("[yokke] Using cached access token for notify (expires in", Math.round((cachedToken.expiresAt - Date.now()) / 1000), "s)");
        return cachedToken.token;
    }

    const clientKey = env.yokkeClientKey!;
    const timestamp = getTimestamp();
    const signature = buildTokenSignature(clientKey, timestamp);

    const headers = {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": clientKey,
        "X-TIMESTAMP":  timestamp,
        "X-SIGNATURE":  signature,
        "X-PLATFORM":   "PORTAL",
    };
    console.log("[yokke] Access token request headers (notify):", headers);

    const res = await fetch(
        env.yokkeIsProduction ? PROD_TOKEN_URL : SANDBOX_TOKEN_URL,
        {
            method: "POST",
            headers,
            body: JSON.stringify({ grantType: "client_credentials" }),
        },
    );

    if (!res.ok) throw new Error("Failed to get Yokke access token for inquiry");
    const data = await res.json();

    // Cache the token
    cachedToken = { token: data.accessToken as string, expiresAt: Date.now() + TOKEN_TTL_MS };
    return cachedToken.token;
}

// ─── Pending payment lookup ───────────────────────────────────────────────────

/**
 * Look up pending payment by external_id first (the documented link between
 * PaymentNotify.originalExternalId ↔ QRGenerate.X-EXTERNAL-ID).
 * Falls back to yokke_reference_no.
 */
async function lookupPendingPayment(
    originalExternalId: string | undefined,
    yokkeReferenceNo: string,
): Promise<{ boothId: string; uuid: string; externalId: string } | null> {
    const supabase = await db();

    // Primary lookup: by external_id (PaymentNotify.originalExternalId = QR Generate X-EXTERNAL-ID)
    if (originalExternalId) {
        console.log("[yokke] Looking up pending payment by external_id:", originalExternalId);
        const { data, error } = await supabase
            .from("yokke_pending_payments")
            .select("booth_id, uuid, external_id")
            .eq("external_id", originalExternalId)
            .single();

        if (!error && data) {
            console.log("[yokke] Found pending payment by external_id:", { boothId: data.booth_id, uuid: data.uuid });
            return { boothId: data.booth_id, uuid: data.uuid, externalId: data.external_id };
        }
        console.warn("[yokke] external_id lookup failed for:", originalExternalId);
    }

    // Fallback: by yokke_reference_no
    console.log("[yokke] Trying yokke_reference_no lookup:", yokkeReferenceNo);
    const { data: fallback, error: fbError } = await supabase
        .from("yokke_pending_payments")
        .select("booth_id, uuid, external_id")
        .eq("yokke_reference_no", yokkeReferenceNo)
        .single();

    if (!fbError && fallback) {
        console.log("[yokke] Found pending payment by yokke_reference_no:", { boothId: fallback.booth_id, uuid: fallback.uuid, externalId: fallback.external_id });
        return { boothId: fallback.booth_id, uuid: fallback.uuid, externalId: fallback.external_id };
    }

    console.warn("[yokke] No pending payment found for externalId:", originalExternalId, "ref:", yokkeReferenceNo);
    return null;
}

// ─── Save payment ─────────────────────────────────────────────────────────────

async function savePayment(
    revenue: string,
    additional: string,
    uuid: string,
    boothid: string,
): Promise<Memento> {
    const supabase = await db();
    const { data, error } = await supabase
        .from("memento")
        .upsert(
            {
                revenue,
                additional,
                uuid,
                boothid,
                is_paid: true,
            },
            { onConflict: "uuid" },
        )
        .select();
    if (error) throw error;
    return data[0];
}

// ─── Notify response helper ───────────────────────────────────────────────────

/** Yokke expects exactly this shape when the notify is accepted. */
function successResponse() {
    return NextResponse.json({
        responseCode:    "2005200",
        responseMessage: "Successful",
    });
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /memento/pay/qr/qr-mpm-notify
 *
 * Yokke calls this endpoint (QR Payment Credit Notify, service code 52) after
 * every payment event.  We verify by calling the inquiry API and, on success,
 * persist the payment.
 */
export async function POST(request: Request) {
    let body: YokkeNotifyPayload;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ responseCode: "4005200", responseMessage: "Bad Request" }, { status: 400 });
    }

    console.log("[yokke] notify received:", JSON.stringify(body));

    const { originalReferenceNo, latestTransactionStatus, amount } = body;

    // Only process successful payments
    if (latestTransactionStatus !== "00") {
        console.log("[yokke] ignoring non-success status:", latestTransactionStatus);
        return successResponse(); // still respond 200 so Yokke won't retry
    }

    try {
        // 1. Look up our internal boothid + uuid from the pending payments table
        //    Primary: PaymentNotify.originalExternalID → DB external_id
        //    Fallback: notify.originalReferenceNo → DB yokke_reference_no
        const rawBody = body as Record<string, unknown>;
        const originalExternalId = (rawBody["originalExternalID"] ?? rawBody["originalExternalId"]) as string | undefined;
        console.log("[yokke] notify body keys:", Object.keys(rawBody));
        console.log("[yokke] notify fields for lookup — originalExternalId:", originalExternalId, "originalReferenceNo:", originalReferenceNo);
        const pending = await lookupPendingPayment(
            originalExternalId,
            originalReferenceNo,
        );
        if (!pending) {
            throw new Error(`No pending payment for externalId: ${originalExternalId} / ref: ${originalReferenceNo}`);
        }
        const { boothId, uuid, externalId } = pending;

        // 2. Call inquiry to double-verify with Yokke
        //    QR Inquiry.originalReferenceNo = QR Generate.referenceNo
        //    QR Inquiry.originalExternalId  = QR Generate.X-EXTERNAL-ID
        const wibNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const txDate = wibNow.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD in WIB
        const accessToken = await getAccessToken();
        const inquiry = await inquireTransaction(
            accessToken,
            originalReferenceNo,
            externalId,
            txDate,
        );

        console.log("[yokke] inquiry result:", inquiry.latestTransactionStatus, inquiry.transactionStatusDesc);

        if (inquiry.latestTransactionStatus !== "00") {
            throw new Error(`Inquiry status not success: ${inquiry.latestTransactionStatus}`);
        }

        // 3. Save the payment
        const revenue    = amount?.value ?? "0";
        const additional = body.additionalInfo?.approvalCode ?? "";

        const memento = await savePayment(revenue, additional, uuid, boothId);
        console.log("[yokke] payment saved:", memento.uuid);

        // 4. Check & send notice-print email if threshold reached
        await checkAndSendNoticePrint(boothId);

        return successResponse();
    } catch (e) {
        console.error("[yokke] notify processing error:", e);
        // Still return 200 with success code so Yokke doesn't retry for our own DB errors
        // but use a different internal log.  Adjust per Yokke's retry policy if needed.
        return NextResponse.json(
            { responseCode: "5005200", responseMessage: "Internal Server Error" },
            { status: 500 },
        );
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MoneyField = { value: string; currency: string };

type YokkeNotifyPayload = {
    originalReferenceNo:     string;
    originalExternalID?:     string; // QR Generate X-EXTERNAL-ID (uppercase ID)
    originalExternalId?:     string; // QR Generate X-EXTERNAL-ID (camelCase)
    latestTransactionStatus: string; // "00" = success
    transactionStatusDesc:   string;
    customerNumber?:         string;
    destinationNumber?:      string;
    amount?:                 MoneyField;
    bankCode?:               string;
    additionalInfo?: {
        merchantId?:       string;
        terminalId?:       string;
        approvalCode?:     string;
        issuerReferenceID?: string;
        customerName?:     string;
        issuerName?:       string;
    };
};

type YokkeInquiryResponse = {
    responseCode:            string;
    responseMessage:         string;
    originalReferenceNo:     string;
    originalExternalId:      string;
    serviceCode:             string;
    latestTransactionStatus: string;
    transactionStatusDesc:   string;
    paidTime?:               string;
    amount?:                 MoneyField;
    feeAmount?:              MoneyField;
    terminalId?:             string;
    additionalInfo?: {
        merchantId?:       string;
        approvalCode?:     string;
        customerName?:     string;
        issuerName?:       string;
        issuerReferenceID?: string;
    };
};
