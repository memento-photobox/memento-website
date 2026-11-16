"use client";

import { useMemo, useState } from "react";
import {
    YOKKE_TEST_CASES,
    buildPreset,
    buildQueryBody,
    isPlaceholderQueryRef,
    matchExpected,
    wibYyyymmdd,
    type AllEnvDefaults,
    type SandboxDefaults,
    type YokkeTestCase,
} from "../lib/test-cases";

type ApiResult = {
    action: "generate" | "query";
    mode?: "sandbox" | "prod";
    callbackPath?: string;
    envConfig?: SandboxDefaults;
    path: string;
    tokenExchange?: {
        request: {
            method: string;
            url: string;
            path: string;
            headers: Record<string, string>;
            body: unknown;
        };
        response: unknown;
        httpStatus: number;
    };
    request: {
        method: string;
        url: string;
        path: string;
        headers: Record<string, string>;
        body: unknown;
    };
    response: Record<string, unknown>;
    httpStatus: number;
    qrContent?: string;
    referenceNo?: string;
    partnerReferenceNo?: string;
    externalId?: string;
    uuid?: string;
    error?: string;
};

type LastTxn = {
    referenceNo?: string;
    externalId?: string;
    partnerReferenceNo?: string;
    originalTransactionDate?: string;
    qrContent?: string;
    uuid?: string;
};

const GROUPS = ["QR Generation", "QR Credit / Notify", "Query Payment", "Auth / Validation"] as const;

function pretty(value: unknown) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "string") {
        try {
            return JSON.stringify(JSON.parse(value), null, 2);
        } catch {
            return value;
        }
    }
    return JSON.stringify(value, null, 2);
}

function formatWagShare(result: ApiResult | null): string {
    if (!result) return "";
    return [
        `Post' URL ${result.request.url}`,
        "RequestHeader:",
        pretty(result.request.headers),
        "",
        "RequestBody:",
        pretty(result.request.body),
        "",
        "ResponseBody:",
        pretty(result.response),
    ].join("\n");
}

function typeBadge(type: YokkeTestCase["type"]) {
    if (type === "Positive") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    if (type === "Negative") return "bg-amber-500/15 text-amber-200 border-amber-500/40";
    return "bg-slate-500/15 text-slate-300 border-slate-500/40";
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        } catch {
            setCopied(false);
        }
    }

    return (
        <button
            type="button"
            onClick={copy}
            disabled={!text}
            className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
            {copied ? "Copied" : label}
        </button>
    );
}

function JsonField({
    id,
    label,
    value,
    onChange,
    rows = 14,
    hint,
}: {
    id: string;
    label: string;
    value: string;
    onChange?: (next: string) => void;
    rows?: number;
    hint?: string;
}) {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                    <label htmlFor={id} className="text-sm font-medium text-slate-100">
                        {label}
                    </label>
                    {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
                </div>
                <CopyButton text={value} />
            </div>
            <textarea
                id={id}
                value={value}
                onChange={onChange ? (e) => onChange(e.target.value) : undefined}
                readOnly={!onChange}
                rows={rows}
                spellCheck={false}
                className="min-h-48 w-full flex-1 resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs leading-5 text-slate-100 outline-none ring-indigo-500/50 focus:ring-2"
            />
        </div>
    );
}

export default function YokkeSandbox({ envDefaults }: { envDefaults: AllEnvDefaults }) {
    const [mode, setMode] = useState<"sandbox" | "prod">(envDefaults.defaultMode);
    const [configs, setConfigs] = useState<{ sandbox: SandboxDefaults; prod: SandboxDefaults }>({
        sandbox: envDefaults.sandbox,
        prod: envDefaults.prod,
    });
    const defaults = configs[mode];

    const [activeId, setActiveId] = useState(YOKKE_TEST_CASES[0].id);
    const active = YOKKE_TEST_CASES.find((tc) => tc.id === activeId) ?? YOKKE_TEST_CASES[0];

    const [generateBody, setGenerateBody] = useState(() =>
        pretty(buildPreset(YOKKE_TEST_CASES[0], envDefaults[envDefaults.defaultMode]).generateBody),
    );
    const [queryBody, setQueryBody] = useState(() =>
        pretty(buildQueryBody(envDefaults[envDefaults.defaultMode])),
    );
    const [invalidToken, setInvalidToken] = useState(false);
    const [invalidSignature, setInvalidSignature] = useState(false);
    const [omitChannelId, setOmitChannelId] = useState(false);
    const [storePending, setStorePending] = useState(true);
    const [showProdDetails, setShowProdDetails] = useState(true);

    const [busy, setBusy] = useState<"generate" | "query" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [lastTxn, setLastTxn] = useState<LastTxn>({});
    const [generateResult, setGenerateResult] = useState<ApiResult | null>(null);
    const [queryResult, setQueryResult] = useState<ApiResult | null>(null);

    const currentResult = active.action === "query" ? queryResult : generateResult;
    const resultCode =
        typeof currentResult?.response?.responseCode === "string"
            ? currentResult.response.responseCode
            : "";
    const latestStatus =
        typeof queryResult?.response?.latestTransactionStatus === "string"
            ? queryResult.response.latestTransactionStatus
            : "";
    const latestStatusDesc =
        typeof queryResult?.response?.transactionStatusDesc === "string"
            ? queryResult.response.transactionStatusDesc
            : "";
    const verdict = currentResult
        ? matchExpected(active.expectedCode, resultCode || undefined)
            ? "PASS"
            : "FAIL"
        : null;
    const needsUnpaidQr = active.id === "query-pending" || active.id === "query-success";

    const grouped = useMemo(() => {
        return GROUPS.map((group) => ({
            group,
            items: YOKKE_TEST_CASES.filter((tc) => tc.group === group),
        })).filter((g) => g.items.length > 0);
    }, []);

    function switchEnvironment(nextMode: "sandbox" | "prod") {
        if (nextMode === mode) return;
        const nextDefaults = configs[nextMode];
        setMode(nextMode);
        setError(null);
        setLastTxn({});
        setGenerateResult(null);
        setQueryResult(null);

        const preset = buildPreset(active, nextDefaults);
        if (preset.generateBody) {
            setGenerateBody(pretty(preset.generateBody));
        } else {
            const fallbackGen = buildPreset(YOKKE_TEST_CASES[0], nextDefaults).generateBody;
            if (fallbackGen) setGenerateBody(pretty(fallbackGen));
        }
        setQueryBody(pretty(preset.queryBody ?? buildQueryBody(nextDefaults)));
    }

    function applyTestCase(tc: YokkeTestCase) {
        setActiveId(tc.id);
        setError(null);
        const preset = buildPreset(tc, defaults, lastTxn);
        if (preset.generateBody) setGenerateBody(pretty(preset.generateBody));
        if (preset.queryBody) setQueryBody(pretty(preset.queryBody));
        setInvalidToken(Boolean(preset.options?.invalidToken));
        setInvalidSignature(Boolean(preset.options?.invalidSignature));
        setOmitChannelId(Boolean(preset.options?.omitChannelId));
        setStorePending(preset.options?.storePending !== false && tc.action === "generate");
    }

    function setQuickAmount(amountValue: string) {
        try {
            const parsed = parseBody(generateBody);
            const nextBody = {
                ...parsed,
                amount: {
                    ...((parsed.amount as Record<string, unknown>) ?? { currency: "IDR" }),
                    value: amountValue,
                    currency: "IDR",
                },
            };
            setGenerateBody(pretty(nextBody));
        } catch {
            // ignore invalid JSON while editing
        }
    }

    function parseBody(raw: string): Record<string, unknown> {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Body must be a JSON object");
        }
        return parsed as Record<string, unknown>;
    }

    function omitEmpty(value: Record<string, unknown>): Record<string, unknown> {
        const next: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            if (item === "" || item === undefined || item === null) continue;
            if (item && typeof item === "object" && !Array.isArray(item)) {
                next[key] = omitEmpty(item as Record<string, unknown>);
            } else {
                next[key] = item;
            }
        }
        return next;
    }

    async function callYokke(action: "generate" | "query", body: Record<string, unknown>) {
        const res = await fetch("/internal/api/yokke", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action,
                mode,
                body: omitEmpty(body),
                options: {
                    mode,
                    invalidToken,
                    invalidSignature,
                    omitChannelId,
                    storePending: action === "generate" ? storePending : false,
                },
            }),
        });
        const data = (await res.json()) as ApiResult & { success?: boolean; error?: string };
        if (!res.ok || data.success === false) {
            throw new Error(data.error || `Request failed (${res.status})`);
        }
        if (data.envConfig) {
            setConfigs((prev) => ({ ...prev, [mode]: data.envConfig! }));
        }
        return data;
    }

    function applyGenerateResult(data: ApiResult, body: Record<string, unknown>) {
        const nextTxn: LastTxn = {
            referenceNo: data.referenceNo,
            externalId: data.externalId,
            partnerReferenceNo: data.partnerReferenceNo,
            originalTransactionDate: wibYyyymmdd(),
            qrContent: data.qrContent,
            uuid: data.uuid,
        };
        setGenerateResult(data);
        setLastTxn(nextTxn);
        setQueryBody(pretty(buildQueryBody(defaults, nextTxn)));
        try {
            const nextBody = {
                ...body,
                partnerReferenceNo: Date.now().toString().padStart(20, "0").slice(-20),
            };
            setGenerateBody(pretty(nextBody));
        } catch {
            // keep current generate body
        }
        return nextTxn;
    }

    async function run(action: "generate" | "query") {
        setBusy(action);
        setError(null);
        try {
            if (action === "generate") {
                const body = parseBody(generateBody);
                const data = await callYokke("generate", body);
                applyGenerateResult(data, body);
                return;
            }

            let inquiryBody = parseBody(queryBody);
            const missingRef = isPlaceholderQueryRef(String(inquiryBody.originalReferenceNo || ""));
            if (needsUnpaidQr && missingRef) {
                const generatePayload = parseBody(generateBody);
                const generated = await callYokke("generate", generatePayload);
                const nextTxn = applyGenerateResult(generated, generatePayload);
                if (!nextTxn.referenceNo && !nextTxn.partnerReferenceNo) {
                    throw new Error("QR generate did not return a reference. Fix generate first, then Check Status.");
                }
                inquiryBody = buildQueryBody(defaults, nextTxn);
                setQueryBody(pretty(inquiryBody));
            } else if (needsUnpaidQr && missingRef === false && lastTxn.originalTransactionDate) {
                inquiryBody = {
                    ...inquiryBody,
                    additionalInfo: {
                        ...((inquiryBody.additionalInfo as Record<string, unknown>) ?? {}),
                        originalTransactionDate: lastTxn.originalTransactionDate,
                    },
                };
            }

            const data = await callYokke("query", inquiryBody);
            setQueryResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    }

    const generateRequestText = generateResult
        ? pretty({
              method: generateResult.request.method,
              url: generateResult.request.url,
              headers: generateResult.request.headers,
          })
        : "";
    const generateBodyText = generateResult ? pretty(generateResult.request.body) : "";
    const generateResponseText = generateResult ? pretty(generateResult.response) : "";

    const queryRequestText = queryResult
        ? pretty({
              method: queryResult.request.method,
              url: queryResult.request.url,
              headers: queryResult.request.headers,
          })
        : "";
    const queryBodyText = queryResult ? pretty(queryResult.request.body) : "";
    const queryResponseText = queryResult ? pretty(queryResult.response) : "";

    const wagGenerateText = formatWagShare(generateResult);
    const wagQueryText = formatWagShare(queryResult);
    const wagCombinedText = [
        `TC #${active.no} - ${active.scenario} (${mode === "prod" ? "PTR / PROD" : "SANDBOX"})`,
        wagGenerateText ? `\n[QR Generate]\n${wagGenerateText}` : "",
        wagQueryText ? `\n[QR Inquiry / Check Status]\n${wagQueryText}` : "",
    ]
        .filter(Boolean)
        .join("\n");

    const formPack = [
        `Environment: ${mode === "prod" ? "Production (PTR)" : "Sandbox"}`,
        `Base URL: ${defaults.baseUrl}`,
        `Callback URL: ${defaults.callbackPath}`,
        `No: ${active.no}`,
        `Service: ${active.service}`,
        `Scenario: ${active.scenario}`,
        `Expected: ${active.expectedCode} ${active.expectedMessage}`.trim(),
        `Result: ${verdict ?? "-"}`,
        `RRN / referenceNo: ${lastTxn.referenceNo || "-"}`,
        `X-EXTERNAL-ID: ${lastTxn.externalId || "-"}`,
        `partnerReferenceNo: ${lastTxn.partnerReferenceNo || "-"}`,
        `originalTransactionDate (WIB): ${lastTxn.originalTransactionDate || "-"}`,
        `latestTransactionStatus: ${latestStatus || "-"} ${latestStatusDesc}`.trim(),
        "",
        "=== Generate Request Payload ===",
        generateRequestText || "-",
        "",
        "=== Generate Request Body ===",
        generateBodyText || "-",
        "",
        "=== Generate Response ===",
        generateResponseText || "-",
        "",
        "=== Check / Inquiry Request Payload ===",
        queryRequestText || "-",
        "",
        "=== Check / Inquiry Request Body ===",
        queryBodyText || "-",
        "",
        "=== Check / Inquiry Response ===",
        queryResponseText || "-",
    ].join("\n");

    return (
        <main className="min-h-dvh bg-slate-950 text-slate-100">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-6 lg:flex-row lg:px-6">
                <aside className="w-full shrink-0 lg:w-80">
                    <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 lg:sticky lg:top-4">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-indigo-400">
                                Internal Yokke Tester
                            </p>
                            <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                                    mode === "prod"
                                        ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                                        : "border-indigo-500/50 bg-indigo-500/15 text-indigo-300"
                                }`}
                            >
                                {mode === "prod" ? "PROD / PTR" : "SANDBOX"}
                            </span>
                        </div>
                        <h1 className="mt-1 text-xl font-semibold">Yokke QR Test Cases</h1>

                        {/* Environment Switcher */}
                        <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-800 bg-slate-950 p-1">
                            <button
                                type="button"
                                onClick={() => switchEnvironment("sandbox")}
                                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                                    mode === "sandbox"
                                        ? "bg-indigo-500 text-white shadow"
                                        : "text-slate-400 hover:text-slate-200"
                                }`}
                            >
                                Sandbox (UAT)
                            </button>
                            <button
                                type="button"
                                onClick={() => switchEnvironment("prod")}
                                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                                    mode === "prod"
                                        ? "bg-amber-500 text-slate-950 shadow"
                                        : "text-slate-400 hover:text-slate-200"
                                }`}
                            >
                                Prod (PTR)
                            </button>
                        </div>

                        <div className="mt-3 space-y-1 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3 text-[11px] text-slate-300">
                            <div className="flex justify-between gap-2">
                                <span className="text-slate-500">Merchant</span>
                                <span className="font-medium text-slate-200">{defaults.merchantName}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                                <span className="text-slate-500">API Host</span>
                                <span className="font-mono text-slate-200">{defaults.baseUrl.replace("https://", "")}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                                <span className="text-slate-500">MID (15d)</span>
                                <span className="font-mono text-slate-200">{defaults.merchantId || "—"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                                <span className="text-slate-500">TID</span>
                                <span className="font-mono text-slate-200">{defaults.terminalId || "—"}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                                <span className="text-slate-500">Callback</span>
                                <span className="font-mono text-emerald-300">{defaults.callbackPath}</span>
                            </div>
                        </div>

                        {!defaults.configured ? (
                            <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                                Yokke {mode.toUpperCase()} env vars are incomplete. Generate/Check will fail until they are set.
                            </p>
                        ) : null}

                        <div className="mt-4 max-h-[62vh] space-y-4 overflow-y-auto pr-1">
                            {grouped.map(({ group, items }) => (
                                <div key={group}>
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                        {group}
                                    </p>
                                    <div className="space-y-1.5">
                                        {items.map((tc) => {
                                            const selected = tc.id === active.id;
                                            return (
                                                <button
                                                    key={tc.id}
                                                    type="button"
                                                    onClick={() => applyTestCase(tc)}
                                                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                                                        selected
                                                            ? "border-indigo-500/70 bg-indigo-500/15"
                                                            : "border-slate-800 bg-slate-950/60 hover:border-slate-600"
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-xs font-semibold text-slate-200">
                                                            #{tc.no} {tc.scenario}
                                                        </span>
                                                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${typeBadge(tc.type)}`}>
                                                            {tc.type}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 text-[11px] text-slate-400">
                                                        {tc.expectedCode} · {tc.expectedMessage || "see notes"}
                                                    </p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </aside>

                <section className="min-w-0 flex-1 space-y-5">
                    {/* PROD / PTR Context Card (from PROD_AGENT.md) */}
                    {mode === "prod" ? (
                        <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-950">
                                            PTR Mode (Production Trial Run)
                                        </span>
                                        <span className="font-mono text-xs text-amber-200">
                                            {defaults.baseUrl}/
                                        </span>
                                    </div>
                                    <h3 className="mt-1.5 text-lg font-semibold text-amber-100">
                                        {defaults.merchantName} — MID {defaults.rawMerchantId} (`{defaults.merchantId}`) · TID {defaults.terminalId}
                                    </h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowProdDetails((v) => !v)}
                                    className="rounded-xl border border-amber-400/40 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/20"
                                >
                                    {showProdDetails ? "Hide PTR Info & Keys" : "Show PTR Info & Keys"}
                                </button>
                            </div>

                            {showProdDetails ? (
                                <div className="mt-4 space-y-4">
                                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                                        <div className="rounded-2xl border border-amber-500/30 bg-slate-950/70 p-3 text-xs">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-400">
                                                X-PARTNER-ID / tokenRequestID
                                            </p>
                                            <p className="mt-1 font-mono text-slate-100">{defaults.partnerId}</p>
                                        </div>
                                        <div className="rounded-2xl border border-amber-500/30 bg-slate-950/70 p-3 text-xs">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-400">
                                                Client ID / X-CLIENT-KEY
                                            </p>
                                            <p className="mt-1 break-all font-mono text-slate-100">{defaults.clientKey}</p>
                                        </div>
                                        <div className="rounded-2xl border border-amber-500/30 bg-slate-950/70 p-3 text-xs">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-400">
                                                Client Secret / Salt Key
                                            </p>
                                            <p className="mt-1 font-mono text-slate-100">{defaults.clientSecretPreview}</p>
                                        </div>
                                        <div className="rounded-2xl border border-amber-500/30 bg-slate-950/70 p-3 text-xs">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-400">
                                                Production Callback URL (v2)
                                            </p>
                                            <p className="mt-1 font-mono text-emerald-300">{defaults.callbackPath}</p>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-amber-500/30 bg-slate-950/70 p-3.5 text-xs text-amber-100/90">
                                        <p className="font-semibold text-amber-200">
                                            Ketentuan PTR (PROD_AGENT.md):
                                        </p>
                                        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed">
                                            <li>
                                                MID/TID PTR (<code>71028859200</code> / <code>86847056</code>) hanya untuk pengujian di environment production, <strong>bukan</strong> untuk transaksi real end-user sebelum Go Live.
                                            </li>
                                            <li>
                                                Untuk amount pengujian boleh nominal kecil: <strong>Rp 1.00 – Rp 5.00</strong> (default preset di mode PTR sudah diset ke <code>1.00</code>).
                                            </li>
                                            <li>
                                                Callback notify production menggunakan endpoint terbaru:{" "}
                                                <code className="text-emerald-300">POST /memento/pay/yokke/v2/notify</code>.
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-[0.18em] text-indigo-300">
                                    {active.method} · {active.service}
                                </p>
                                <h2 className="mt-1 text-2xl font-semibold">
                                    #{active.no} {active.scenario}
                                </h2>
                                <p className="mt-2 max-w-3xl text-sm text-slate-300">{active.steps}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-right">
                                <p className="text-[11px] uppercase tracking-wider text-slate-500">Expected</p>
                                <p className="font-mono text-sm text-slate-100">{active.expectedCode}</p>
                                <p className="text-xs text-slate-400">{active.expectedMessage || "—"}</p>
                                {verdict ? (
                                    <p className={`mt-2 text-sm font-semibold ${verdict === "PASS" ? "text-emerald-300" : "text-rose-300"}`}>
                                        {verdict}
                                        {resultCode ? ` · ${resultCode}` : ""}
                                    </p>
                                ) : null}
                                {latestStatus ? (
                                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                                        status {latestStatus}
                                        {latestStatusDesc ? ` · ${latestStatusDesc}` : ""}
                                        {latestStatus === "00"
                                            ? " (paid)"
                                            : latestStatus === "01" || latestStatus === "03"
                                              ? " (pending / unpaid)"
                                              : ""}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                        <p className="mt-3 text-xs text-slate-400">{active.notes}</p>
                        {needsUnpaidQr ? (
                            <p className="mt-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100">
                                Yokke query looks up a <strong>payment</strong>, not just a generated QR.
                                Check Status on a brand-new unpaid QR returns <code>4045101 Transaction Not Found</code>.
                                Scan the QR in the issuer/partner app so a payment is created, then Check Status again
                                for <code>2005100</code> (status 01/03 pending, or 00 if already paid).
                            </p>
                        ) : null}
                        {needsUnpaidQr && resultCode === "4045101" ? (
                            <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                                Last Check Status was 4045101 — Yokke has no payment yet for RRN {lastTxn.referenceNo || "—"}.
                                Keep this QR on screen, start the payment from the issuer app, then Check Status again.
                                Do not generate a new QR in between.
                            </p>
                        ) : null}
                    </div>

                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                        <div className="space-y-5">
                            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-lg font-semibold">Request editor</h3>
                                        <p className="text-xs text-slate-400">
                                            Target: <code className="text-slate-200">{defaults.baseUrl}</code> · Callback:{" "}
                                            <code className="text-emerald-300">{defaults.callbackPath}</code>
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {mode === "prod" ? (
                                            <div className="flex items-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs">
                                                <span className="px-1 text-[11px] text-amber-200">PTR Nominal:</span>
                                                {(["1.00", "2.00", "5.00"] as const).map((amt) => (
                                                    <button
                                                        key={amt}
                                                        type="button"
                                                        onClick={() => setQuickAmount(amt)}
                                                        className="rounded-lg border border-amber-400/40 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-amber-200 hover:bg-amber-500/20"
                                                    >
                                                        Rp {amt}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={() => run("generate")}
                                            disabled={busy !== null}
                                            className={`rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                                                mode === "prod"
                                                    ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
                                                    : "bg-indigo-500 text-white hover:bg-indigo-400"
                                            }`}
                                        >
                                            {busy === "generate"
                                                ? "Generating…"
                                                : mode === "prod"
                                                  ? "Generate QR (PTR)"
                                                  : "Generate QR"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => run("query")}
                                            disabled={busy !== null}
                                            className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-800 disabled:opacity-50"
                                        >
                                            {busy === "query" ? "Checking…" : "Check Status"}
                                        </button>
                                    </div>
                                </div>

                                {error ? (
                                    <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                                        {error}
                                    </div>
                                ) : null}

                                <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-300">
                                    <label className="flex items-center gap-2">
                                        <input type="checkbox" checked={invalidToken} onChange={(e) => setInvalidToken(e.target.checked)} />
                                        Invalid access token
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input type="checkbox" checked={invalidSignature} onChange={(e) => setInvalidSignature(e.target.checked)} />
                                        Invalid signature
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input type="checkbox" checked={omitChannelId} onChange={(e) => setOmitChannelId(e.target.checked)} />
                                        Omit CHANNEL-ID
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input type="checkbox" checked={storePending} onChange={(e) => setStorePending(e.target.checked)} />
                                        Store pending payment (so {defaults.callbackPath} can match)
                                    </label>
                                </div>

                                <div className="grid gap-4 lg:grid-cols-2">
                                    <JsonField
                                        id="generate-body"
                                        label="Generate request body"
                                        hint={`POST ${defaults.baseUrl}/v2.0/qr/qr-mpm-generate`}
                                        value={generateBody}
                                        onChange={setGenerateBody}
                                    />
                                    <JsonField
                                        id="query-body"
                                        label="Check / inquiry request body"
                                        hint={`POST ${defaults.baseUrl}/v3.0/qr/qr-mpm-query — auto-filled after generate (WIB date)`}
                                        value={queryBody}
                                        onChange={setQueryBody}
                                    />
                                </div>
                            </div>

                            {/* WAG Share Format (from PROD_AGENT.md) */}
                            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-lg font-semibold">Format Share WAG (PTR / UAT Log)</h3>
                                        <p className="text-xs text-slate-400">
                                            Format sesuai <code>PROD_AGENT.md</code> (<code>Post&apos; URL</code>, <code>RequestHeader</code>, <code>RequestBody</code>, <code>ResponseBody</code>).
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <CopyButton text={wagGenerateText} label="Copy Generate WAG" />
                                        <CopyButton text={wagQueryText} label="Copy Inquiry WAG" />
                                        <CopyButton text={wagCombinedText} label="Copy Both for WAG" />
                                    </div>
                                </div>
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <JsonField
                                        id="wag-generate"
                                        label="WAG Format — Generate QR"
                                        value={wagGenerateText}
                                        rows={14}
                                    />
                                    <JsonField
                                        id="wag-query"
                                        label="WAG Format — Check Status / Inquiry"
                                        value={wagQueryText}
                                        rows={14}
                                    />
                                </div>
                            </div>

                            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-lg font-semibold">Form fields</h3>
                                        <p className="text-xs text-slate-400">
                                            Copy these into the spreadsheet Request / Response columns after each step.
                                        </p>
                                    </div>
                                    <CopyButton text={formPack} label="Copy all for form" />
                                </div>

                                <div className="grid gap-5">
                                    <div>
                                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
                                            After Generate QR
                                        </p>
                                        <div className="grid gap-4 lg:grid-cols-3">
                                            <JsonField id="gen-payload" label="Request payload" hint="Headers + URL actually sent" value={generateRequestText} rows={16} />
                                            <JsonField id="gen-req-body" label="Request body" value={generateBodyText} rows={16} />
                                            <JsonField id="gen-res" label="Response" value={generateResponseText} rows={16} />
                                        </div>
                                    </div>
                                    <div>
                                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-300">
                                            After Check Status (payment / inquiry)
                                        </p>
                                        <div className="grid gap-4 lg:grid-cols-3">
                                            <JsonField id="qry-payload" label="Request payload" value={queryRequestText} rows={16} />
                                            <JsonField id="qry-req-body" label="Request body" value={queryBodyText} rows={16} />
                                            <JsonField id="qry-res" label="Response" value={queryResponseText} rows={16} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <aside className="space-y-5">
                            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                                <h3 className="text-lg font-semibold">Generated QR</h3>
                                <p className="mt-1 text-xs text-slate-400">
                                    Scan this after a successful generate, then click Check Status.
                                </p>
                                <div className="mt-4 flex min-h-64 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 p-4">
                                    {lastTxn.qrContent ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(lastTxn.qrContent)}`}
                                            alt="Yokke QR"
                                            className="h-60 w-60 rounded-lg bg-white p-2"
                                        />
                                    ) : (
                                        <p className="text-center text-sm text-slate-500">QR appears here after a successful generate.</p>
                                    )}
                                </div>
                                {lastTxn.qrContent ? (
                                    <div className="mt-3">
                                        <div className="mb-1 flex items-center justify-between">
                                            <p className="text-xs font-medium text-slate-300">qrContent</p>
                                            <CopyButton text={lastTxn.qrContent} />
                                        </div>
                                        <p className="break-all rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[10px] leading-4 text-slate-400">
                                            {lastTxn.qrContent}
                                        </p>
                                    </div>
                                ) : null}
                            </div>

                            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 text-sm">
                                <h3 className="text-lg font-semibold">Last transaction</h3>
                                <dl className="mt-3 space-y-2 text-xs">
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-slate-500">environment</dt>
                                        <dd className="font-mono text-slate-200">{mode === "prod" ? "PROD / PTR" : "SANDBOX"}</dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-slate-500">referenceNo / RRN</dt>
                                        <dd className="font-mono text-slate-200">{lastTxn.referenceNo || "—"}</dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-slate-500">X-EXTERNAL-ID</dt>
                                        <dd className="font-mono text-slate-200">{lastTxn.externalId || "—"}</dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-slate-500">partnerReferenceNo</dt>
                                        <dd className="break-all text-right font-mono text-slate-200">
                                            {lastTxn.partnerReferenceNo || "—"}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-slate-500">tx date (WIB)</dt>
                                        <dd className="font-mono text-slate-200">
                                            {lastTxn.originalTransactionDate || "—"}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-slate-500">inquiry status</dt>
                                        <dd className="font-mono text-slate-200">
                                            {latestStatus ? `${latestStatus}${latestStatusDesc ? ` ${latestStatusDesc}` : ""}` : "—"}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <dt className="text-slate-500">db uuid</dt>
                                        <dd className="break-all text-right font-mono text-slate-200">{lastTxn.uuid || "—"}</dd>
                                    </div>
                                </dl>
                                <p className="mt-4 text-xs text-slate-500">
                                    Payment notify hits{" "}
                                    <code className="text-emerald-300">{defaults.callbackPath}</code> and
                                    replies <code className="text-slate-300">2005200 Successful</code> when accepted.
                                </p>
                            </div>
                        </aside>
                    </div>
                </section>
            </div>
        </main>
    );
}
