import { createSign, createHmac, createHash, randomUUID } from "crypto";
import { env } from "@/app/env";
import { db } from "@/utils/supabase/server";

const SANDBOX_BASE = "https://tst.yokke.co.id:7778";
const PROD_BASE = "https://api.yokke.co.id:7778";

export const TOKEN_PATH = "/qr/v2.0/access-token/b2b";
export const GENERATE_PATH = "/v2.0/qr/qr-mpm-generate";
/** Align with /memento/pay/qr/qr-mpm-notify — Yokke sandbox inquiry is v3. */
export const QUERY_PATH = "/v3.0/qr/qr-mpm-query";

export function getYokkeBase() {
    return env.yokkeIsProduction ? PROD_BASE : SANDBOX_BASE;
}

export function getTimestamp(): string {
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

function todayPrefix(): string {
    return new Date()
        .toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" })
        .split("/")
        .reverse()
        .join("");
}

export function generatePartnerRef(): string {
    const date = todayPrefix();
    const millis = (Date.now() % 100000).toString().padStart(5, "0");
    const rand = Math.floor(Math.random() * 10000000).toString().padStart(7, "0");
    return date + millis + rand;
}

export function generateExternalId(): string {
    const date = todayPrefix();
    const millis = (Date.now() % 10000).toString().padStart(4, "0");
    const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
    return date + millis + rand;
}

export function todayYyyymmdd(): string {
    const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return wib.toISOString().slice(0, 10).replace(/-/g, "");
}

function buildTokenSignature(clientKey: string, timestamp: string): string {
    const signer = createSign("SHA256");
    signer.update(`${clientKey}|${timestamp}`);
    return signer.sign(env.yokkePrivateKey!, "base64");
}

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

const TOKEN_TTL_MS = 50 * 60 * 1000;
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<{
    token: string;
    request: YokkeRequestSnapshot;
    response: unknown;
    httpStatus: number;
}> {
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
        return {
            token: cachedToken.token,
            request: {
                method: "POST",
                url: `${getYokkeBase()}${TOKEN_PATH}`,
                path: TOKEN_PATH,
                headers: { cached: "true" },
                body: { grantType: "client_credentials" },
            },
            response: { accessToken: `${cachedToken.token.slice(0, 20)}...[CACHED]` },
            httpStatus: 200,
        };
    }

    const clientKey = env.yokkeClientKey!;
    const timestamp = getTimestamp();
    const signature = buildTokenSignature(clientKey, timestamp);
    const url = `${getYokkeBase()}${TOKEN_PATH}`;
    const headers = {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": clientKey,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        "X-PLATFORM": "PORTAL",
    };
    const body = { grantType: "client_credentials" };

    const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    const response = await res.json().catch(() => ({}));

    if (res.ok && response.accessToken) {
        cachedToken = { token: response.accessToken as string, expiresAt: Date.now() + TOKEN_TTL_MS };
    }

    return {
        token: (response.accessToken as string) ?? "",
        request: { method: "POST", url, path: TOKEN_PATH, headers, body },
        response,
        httpStatus: res.status,
    };
}

export type YokkeRequestSnapshot = {
    method: string;
    url: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;
};

export type YokkeCallOptions = {
    invalidToken?: boolean;
    invalidSignature?: boolean;
    omitChannelId?: boolean;
    channelId?: string;
    externalId?: string;
    storePending?: boolean;
    /** Override inquiry path. Defaults to QUERY_PATH (v3.0). */
    queryPath?: string;
};

export type YokkeCallResult = {
    request: YokkeRequestSnapshot;
    response: Record<string, unknown>;
    httpStatus: number;
    qrContent?: string;
    referenceNo?: string;
    partnerReferenceNo?: string;
    externalId?: string;
    uuid?: string;
};

export async function callYokkeApi(
    path: string,
    body: object,
    options: YokkeCallOptions = {},
): Promise<YokkeCallResult> {
    if (!env.yokkeClientKey || !env.yokkePrivateKey || !env.yokkeClientSecret || !env.yokkePartnerId) {
        throw new Error("Missing required Yokke environment variables");
    }

    let accessToken = "";
    if (options.invalidToken) {
        accessToken = "INVALID_ACCESS_TOKEN_FOR_TESTING";
    } else {
        const tokenResult = await getAccessToken();
        if (!tokenResult.token) {
            return {
                request: tokenResult.request,
                response: tokenResult.response as Record<string, unknown>,
                httpStatus: tokenResult.httpStatus,
                externalId: options.externalId,
            };
        }
        accessToken = tokenResult.token;
    }

    const timestamp = getTimestamp();
    const externalId = options.externalId || generateExternalId();
    const channelId = options.channelId ?? env.yokkeChannelId ?? "02";

    let signature = "";
    if (options.invalidSignature) {
        signature = "INVALID_SIGNATURE_FOR_TESTING_aAbBcCdDeEfFgGhH==";
    } else {
        signature = buildApiSignature("POST", path, accessToken, body, timestamp);
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        "X-EXTERNAL-ID": externalId,
        "X-PARTNER-ID": env.yokkePartnerId,
    };

    if (!options.omitChannelId) {
        headers["CHANNEL-ID"] = channelId;
    }

    const url = `${getYokkeBase()}${path}`;
    const request: YokkeRequestSnapshot = { method: "POST", url, path, headers, body };

    let httpStatus = 0;
    let response: Record<string, unknown> = {};

    try {
        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        httpStatus = res.status;
        const text = await res.text();
        try {
            response = JSON.parse(text) as Record<string, unknown>;
        } catch {
            response = { rawText: text };
        }
    } catch (err) {
        response = { error: err instanceof Error ? err.message : String(err) };
    }

    const result: YokkeCallResult = {
        request,
        response,
        httpStatus,
        qrContent: typeof response.qrContent === "string" ? response.qrContent : undefined,
        referenceNo: typeof response.referenceNo === "string" ? response.referenceNo : undefined,
        partnerReferenceNo:
            typeof response.partnerReferenceNo === "string"
                ? response.partnerReferenceNo
                : typeof (body as { partnerReferenceNo?: string }).partnerReferenceNo === "string"
                  ? (body as { partnerReferenceNo: string }).partnerReferenceNo
                  : undefined,
        externalId,
    };

    if (options.storePending && result.qrContent) {
        const uuid = randomUUID();
        result.uuid = uuid;
        const partnerRef =
            result.partnerReferenceNo ??
            (body as { partnerReferenceNo?: string }).partnerReferenceNo ??
            generatePartnerRef();
        await storePendingPayment(partnerRef, result.referenceNo ?? null, externalId, uuid);
    }

    return result;
}

async function storePendingPayment(
    partnerReferenceNo: string,
    yokkeReferenceNo: string | null,
    externalId: string,
    uuid: string,
): Promise<void> {
    try {
        const supabase = await db();
        const { error } = await supabase.from("yokke_pending_payments").insert({
            partner_reference_no: partnerReferenceNo,
            yokke_reference_no: yokkeReferenceNo,
            external_id: externalId,
            booth_id: "internal-sandbox",
            uuid,
        });
        if (error) {
            console.warn("[internal/yokke] pending payment insert skipped:", error.message);
        }
    } catch (err) {
        console.warn("[internal/yokke] pending payment insert failed:", err);
    }
}

export function getSandboxDefaults() {
    return {
        merchantId: env.yokkeMerchantId ?? "",
        terminalId: env.yokkeTerminalId ?? "",
        partnerId: env.yokkePartnerId ?? "",
        channelId: env.yokkeChannelId ?? "02",
        isProduction: env.yokkeIsProduction,
        configured: Boolean(
            env.yokkeClientKey &&
                env.yokkePrivateKey &&
                env.yokkeClientSecret &&
                env.yokkePartnerId &&
                env.yokkeMerchantId &&
                env.yokkeTerminalId,
        ),
    };
}
