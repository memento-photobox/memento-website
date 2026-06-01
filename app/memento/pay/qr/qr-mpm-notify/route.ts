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

// ─── Timestamp ────────────────────────────────────────────────────────────────

function getTimestamp(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "+07:00");
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

async function getAccessToken(): Promise<string> {
    const clientKey = env.yokkeClientKey!;
    const timestamp = getTimestamp();
    const signature = buildTokenSignature(clientKey, timestamp);

    const res = await fetch(
        env.yokkeIsProduction ? PROD_TOKEN_URL : SANDBOX_TOKEN_URL,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CLIENT-KEY": clientKey,
                "X-TIMESTAMP":  timestamp,
                "X-SIGNATURE":  signature,
                "X-PLATFORM":   "PORTAL",
            },
            body: JSON.stringify({ grantType: "client_credentials" }),
        },
    );

    if (!res.ok) throw new Error("Failed to get Yokke access token for inquiry");
    const data = await res.json();
    return data.accessToken as string;
}

// ─── Pending payment lookup ───────────────────────────────────────────────────

async function lookupPendingPayment(
    yokkeReferenceNo: string,
): Promise<{ boothId: string; uuid: string } | null> {
    const supabase = await db();
    const { data, error } = await supabase
        .from("yokke_pending_payments")
        .select("booth_id, uuid")
        .eq("yokke_reference_no", yokkeReferenceNo)
        .single();

    if (error || !data) {
        console.warn("[yokke] No pending payment found for ref:", yokkeReferenceNo);
        return null;
    }
    return { boothId: data.booth_id, uuid: data.uuid };
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
        const pending = await lookupPendingPayment(originalReferenceNo);
        if (!pending) {
            throw new Error(`No pending payment for Yokke ref: ${originalReferenceNo}`);
        }
        const { boothId, uuid } = pending;

        // 2. Call inquiry to double-verify with Yokke
        const txDate = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
        const accessToken = await getAccessToken();
        const inquiry = await inquireTransaction(
            accessToken,
            originalReferenceNo,
            body.additionalInfo?.issuerReferenceID ?? originalReferenceNo,
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
