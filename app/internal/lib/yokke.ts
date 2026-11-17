import { createSign, createHmac, createHash, randomUUID } from "crypto";
import { env } from "@/app/env";
import { db } from "@/utils/supabase/server";

export const SANDBOX_BASE = "https://tst.yokke.co.id:7778";
export const PROD_BASE = "https://api.yokke.co.id:7778";

export const TOKEN_PATH = "/qr/v2.0/access-token/b2b";
export const GENERATE_PATH = "/v2.0/qr/qr-mpm-generate";
/** Align with /memento/pay/qr/qr-mpm-notify and /memento/pay/yokke/v2/notify — Yokke inquiry is v3. */
export const QUERY_PATH = "/v3.0/qr/qr-mpm-query";

export const SANDBOX_CALLBACK_PATH = "/memento/pay/qr/qr-mpm-notify";
export const PROD_CALLBACK_PATH = "/memento/pay/yokke/v2/notify";

export type YokkeEnvMode = "sandbox" | "prod";

type ResolvedCredentials = {
    mode: YokkeEnvMode;
    isProduction: boolean;
    baseUrl: string;
    callbackPath: string;
    clientKey: string;
    clientSecret: string;
    privateKey: string;
    publicKey: string;
    partnerId: string;
    channelId: string;
    merchantId: string;
    terminalId: string;
    merchantName: string;
};

export function normalizePem(raw: string, type: "PRIVATE KEY" | "RSA PRIVATE KEY" | "PUBLIC KEY" = "RSA PRIVATE KEY"): string {
    const trimmed = raw.trim().replace(/\\n/g, "\n");
    if (!trimmed) return "";
    if (trimmed.includes("-----BEGIN")) return trimmed;
    const clean = trimmed.replace(/\s+/g, "");
    const lines = clean.match(/.{1,64}/g)?.join("\n") ?? clean;
    return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

export function resolveYokkeCredentials(
    mode: YokkeEnvMode = env.yokkeIsProduction ? "prod" : "sandbox",
): ResolvedCredentials {
    if (mode === "prod") {
        const rawPriv = env.yokkeProdPrivateKey || env.yokkePrivateKey || "";
        return {
            mode: "prod",
            isProduction: true,
            baseUrl: PROD_BASE,
            callbackPath: PROD_CALLBACK_PATH,
            clientKey: env.yokkeProdClientKey || "",
            clientSecret: env.yokkeProdClientSecret || "",
            privateKey: normalizePem(rawPriv, "RSA PRIVATE KEY"),
            publicKey: normalizePem(env.yokkeProdPublicKey || "", "PUBLIC KEY"),
            partnerId: env.yokkeProdPartnerId || "MEMENTOMPMSNAP",
            channelId: env.yokkeProdChannelId || "02",
            merchantId: env.yokkeProdMerchantId || "000071028859200",
            terminalId: env.yokkeProdTerminalId || "86847056",
            merchantName: env.yokkeProdMerchantName || "PTR API QRIS 3 DJAKARTA",
        };
    }

    return {
        mode: "sandbox",
        isProduction: false,
        baseUrl: SANDBOX_BASE,
        callbackPath: SANDBOX_CALLBACK_PATH,
        clientKey: env.yokkeClientKey || "",
        clientSecret: env.yokkeClientSecret || "",
        privateKey: normalizePem(env.yokkePrivateKey || "", "RSA PRIVATE KEY"),
        publicKey: "",
        partnerId: env.yokkePartnerId || "MEMENTOMPMSNAP",
        channelId: env.yokkeChannelId || "02",
        merchantId: env.yokkeMerchantId || "",
        terminalId: env.yokkeTerminalId || "",
        merchantName: "Yokke Sandbox",
    };
}

export function getYokkeBase(mode?: YokkeEnvMode) {
    if (mode) return mode === "prod" ? PROD_BASE : SANDBOX_BASE;
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

function buildTokenSignature(clientKey: string, timestamp: string, privateKey: string): string {
    const signer = createSign("SHA256");
    signer.update(`${clientKey}|${timestamp}`);
    return signer.sign(privateKey, "base64");
}

function buildApiSignature(
    method: string,
    endpointPath: string,
    accessToken: string,
    body: object,
    timestamp: string,
    clientSecret: string,
): string {
    const bodyHash = createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex")
        .toLowerCase();
    const stringToSign = [method, endpointPath, accessToken, bodyHash, timestamp].join(":");
    return createHmac("sha512", clientSecret).update(stringToSign).digest("base64");
}

const TOKEN_TTL_MS = 50 * 60 * 1000;
const cachedTokens: Partial<Record<YokkeEnvMode, { token: string; expiresAt: number }>> = {};

export async function getAccessToken(
    mode: YokkeEnvMode = env.yokkeIsProduction ? "prod" : "sandbox",
): Promise<{
    token: string;
    request: YokkeRequestSnapshot;
    response: unknown;
    httpStatus: number;
}> {
    const creds = resolveYokkeCredentials(mode);
    const cached = cachedTokens[mode];

    if (cached && Date.now() < cached.expiresAt) {
        console.log(`[yokke/internal] Using cached ${mode} access token (expires in ${Math.round((cached.expiresAt - Date.now()) / 1000)}s)`);
        return {
            token: cached.token,
            request: {
                method: "POST",
                url: `${creds.baseUrl}${TOKEN_PATH}`,
                path: TOKEN_PATH,
                headers: { cached: "true", environment: mode },
                body: { grantType: "client_credentials" },
            },
            response: { accessToken: `${cached.token.slice(0, 20)}...[CACHED]` },
            httpStatus: 200,
        };
    }

    const timestamp = getTimestamp();
    const signature = buildTokenSignature(creds.clientKey, timestamp, creds.privateKey);
    const url = `${creds.baseUrl}${TOKEN_PATH}`;
    const headers = {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": creds.clientKey,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        "X-PLATFORM": "PORTAL",
    };
    const body = { grantType: "client_credentials" };

    console.log(`[yokke/internal] Token Request (${mode}):`, JSON.stringify({ url, headers, body }));

    const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    const response = await res.json().catch(() => ({}));

    console.log(`[yokke/internal] Token Response (${mode}) [HTTP ${res.status}]:`, JSON.stringify(response));

    if (res.ok && response.accessToken) {
        cachedTokens[mode] = {
            token: response.accessToken as string,
            expiresAt: Date.now() + TOKEN_TTL_MS,
        };
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
    mode?: YokkeEnvMode;
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
    mode: YokkeEnvMode;
    callbackPath: string;
    tokenExchange?: {
        request: YokkeRequestSnapshot;
        response: unknown;
        httpStatus: number;
    };
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
    const mode: YokkeEnvMode = options.mode ?? (env.yokkeIsProduction ? "prod" : "sandbox");
    const creds = resolveYokkeCredentials(mode);

    if (!creds.clientKey || !creds.privateKey || !creds.clientSecret || !creds.partnerId) {
        throw new Error(`Missing required Yokke ${mode.toUpperCase()} environment variables`);
    }

    let accessToken = "";
    let tokenExchange: YokkeCallResult["tokenExchange"] | undefined;
    if (options.invalidToken) {
        accessToken = "INVALID_ACCESS_TOKEN_FOR_TESTING";
    } else {
        const tokenResult = await getAccessToken(mode);
        tokenExchange = {
            request: tokenResult.request,
            response: tokenResult.response,
            httpStatus: tokenResult.httpStatus,
        };
        if (!tokenResult.token) {
            return {
                mode,
                callbackPath: creds.callbackPath,
                tokenExchange,
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
    const channelId = options.channelId ?? creds.channelId ?? "02";

    let signature = "";
    if (options.invalidSignature) {
        signature = "INVALID_SIGNATURE_FOR_TESTING_aAbBcCdDeEfFgGhH==";
    } else {
        signature = buildApiSignature("POST", path, accessToken, body, timestamp, creds.clientSecret);
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        "X-EXTERNAL-ID": externalId,
        "X-PARTNER-ID": creds.partnerId,
    };

    if (!options.omitChannelId) {
        headers["CHANNEL-ID"] = channelId;
    }

    const url = `${creds.baseUrl}${path}`;
    const request: YokkeRequestSnapshot = { method: "POST", url, path, headers, body };

    console.log(`[yokke/internal] Request (${mode}) -> Post' URL ${url}`);
    console.log(`[yokke/internal] RequestHeader (${mode}):`, JSON.stringify(headers));
    console.log(`[yokke/internal] RequestBody (${mode}):`, JSON.stringify(body));

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

    console.log(`[yokke/internal] ResponseBody (${mode}) [HTTP ${httpStatus}]:`, JSON.stringify(response));
    console.log(
        `[yokke/internal] WAG Log (${mode}):\nPost' URL ${url}\nRequestHeader:\n${JSON.stringify(headers, null, 2)}\n\nRequestBody:\n${JSON.stringify(body, null, 2)}\n\nResponseBody:\n${JSON.stringify(response, null, 2)}`,
    );

    const result: YokkeCallResult = {
        mode,
        callbackPath: creds.callbackPath,
        tokenExchange,
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
        await storePendingPayment(
            partnerRef,
            result.referenceNo ?? null,
            externalId,
            uuid,
            mode === "prod" ? "internal-prod" : "internal-sandbox",
        );
    }

    return result;
}

async function storePendingPayment(
    partnerReferenceNo: string,
    yokkeReferenceNo: string | null,
    externalId: string,
    uuid: string,
    boothId: string,
): Promise<void> {
    try {
        const supabase = await db();
        const { error } = await supabase.from("yokke_pending_payments").insert({
            partner_reference_no: partnerReferenceNo,
            yokke_reference_no: yokkeReferenceNo,
            external_id: externalId,
            booth_id: boothId,
            uuid,
        });
        if (error) {
            console.warn("[yokke/internal] pending payment insert skipped:", error.message);
        } else {
            console.log("[yokke/internal] stored pending payment:", JSON.stringify({
                partnerReferenceNo,
                yokkeReferenceNo,
                externalId,
                boothId,
                uuid,
            }));
        }
    } catch (err) {
        console.warn("[yokke/internal] pending payment insert failed:", err);
    }
}

export function getEnvConfig(mode: YokkeEnvMode) {
    const creds = resolveYokkeCredentials(mode);

    return {
        mode,
        merchantName: creds.merchantName,
        merchantId: creds.merchantId,
        rawMerchantId: creds.merchantId.replace(/^0+/, ""),
        terminalId: creds.terminalId,
        partnerId: creds.partnerId,
        channelId: creds.channelId,
        clientKey: creds.clientKey,
        clientSecretPreview: creds.clientSecret ? `${creds.clientSecret.slice(0, 8)}...${creds.clientSecret.slice(-4)}` : "",
        baseUrl: creds.baseUrl,
        callbackPath: creds.callbackPath,
        isProduction: creds.isProduction,
        defaultAmount: creds.isProduction ? "1.00" : "10000.00",
        configured: Boolean(
            creds.clientKey &&
                creds.privateKey &&
                creds.clientSecret &&
                creds.partnerId &&
                creds.merchantId &&
                creds.terminalId,
        ),
    };
}

export function getSandboxDefaults(mode: YokkeEnvMode = env.yokkeIsProduction ? "prod" : "sandbox") {
    return getEnvConfig(mode);
}

export function getAllEnvDefaults() {
    return {
        defaultMode: (env.yokkeIsProduction ? "prod" : "sandbox") as YokkeEnvMode,
        sandbox: getEnvConfig("sandbox"),
        prod: getEnvConfig("prod"),
    };
}
