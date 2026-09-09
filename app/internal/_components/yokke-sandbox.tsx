"use client";

import { useMemo, useState } from "react";
import {
    YOKKE_TEST_CASES,
    buildPreset,
    matchExpected,
    type SandboxDefaults,
    type YokkeTestCase,
} from "../lib/test-cases";

type ApiResult = {
    action: "generate" | "query";
    path: string;
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

export default function YokkeSandbox({ defaults }: { defaults: SandboxDefaults }) {
    const [activeId, setActiveId] = useState(YOKKE_TEST_CASES[0].id);
    const active = YOKKE_TEST_CASES.find((tc) => tc.id === activeId) ?? YOKKE_TEST_CASES[0];

    const [generateBody, setGenerateBody] = useState(() =>
        pretty(buildPreset(YOKKE_TEST_CASES[0], defaults).generateBody),
    );
    const [queryBody, setQueryBody] = useState(() => pretty(buildPreset(YOKKE_TEST_CASES[0], defaults).queryBody ?? {
        originalReferenceNo: "",
        originalExternalId: "",
        serviceCode: "47",
        merchantId: defaults.merchantId,
        additionalInfo: {
            originalTransactionDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
            terminalId: defaults.terminalId,
        },
    }));
    const [invalidToken, setInvalidToken] = useState(false);
    const [invalidSignature, setInvalidSignature] = useState(false);
    const [omitChannelId, setOmitChannelId] = useState(false);
    const [storePending, setStorePending] = useState(true);

    const [busy, setBusy] = useState<"generate" | "query" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [lastTxn, setLastTxn] = useState<LastTxn>({});
    const [generateResult, setGenerateResult] = useState<ApiResult | null>(null);
    const [queryResult, setQueryResult] = useState<ApiResult | null>(null);

    const currentResult = active.action === "query" ? queryResult : generateResult;
    const resultCode = typeof currentResult?.response?.responseCode === "string"
        ? currentResult.response.responseCode
        : "";
    const verdict = currentResult
        ? matchExpected(active.expectedCode, resultCode || undefined)
            ? "PASS"
            : "FAIL"
        : null;

    const grouped = useMemo(() => {
        return GROUPS.map((group) => ({
            group,
            items: YOKKE_TEST_CASES.filter((tc) => tc.group === group),
        })).filter((g) => g.items.length > 0);
    }, []);

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

    function parseBody(raw: string): Record<string, unknown> {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Body must be a JSON object");
        }
        return parsed as Record<string, unknown>;
    }

    async function run(action: "generate" | "query") {
        setBusy(action);
        setError(null);
        try {
            const body = parseBody(action === "query" ? queryBody : generateBody);
            const res = await fetch("/internal/api/yokke", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    body,
                    options: {
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

            if (action === "generate") {
                setGenerateResult(data);
                const nextTxn: LastTxn = {
                    referenceNo: data.referenceNo,
                    externalId: data.externalId,
                    partnerReferenceNo: data.partnerReferenceNo,
                    qrContent: data.qrContent,
                    uuid: data.uuid,
                };
                setLastTxn(nextTxn);
                if (data.referenceNo || data.externalId) {
                    setQueryBody(pretty({
                        originalReferenceNo: data.referenceNo || "",
                        originalExternalId: data.externalId || "",
                        serviceCode: "47",
                        merchantId: defaults.merchantId,
                        additionalInfo: {
                            originalTransactionDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
                            terminalId: defaults.terminalId,
                        },
                    }));
                }
                try {
                    const nextBody = { ...body, partnerReferenceNo: Date.now().toString().padStart(20, "0").slice(-20) };
                    setGenerateBody(pretty(nextBody));
                } catch {
                    // keep current generate body
                }
            } else {
                setQueryResult(data);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(null);
        }
    }

    const generateRequestText = generateResult ? pretty({
        method: generateResult.request.method,
        url: generateResult.request.url,
        headers: generateResult.request.headers,
    }) : "";
    const generateBodyText = generateResult ? pretty(generateResult.request.body) : "";
    const generateResponseText = generateResult ? pretty(generateResult.response) : "";

    const queryRequestText = queryResult ? pretty({
        method: queryResult.request.method,
        url: queryResult.request.url,
        headers: queryResult.request.headers,
    }) : "";
    const queryBodyText = queryResult ? pretty(queryResult.request.body) : "";
    const queryResponseText = queryResult ? pretty(queryResult.response) : "";

    const formPack = [
        `No: ${active.no}`,
        `Service: ${active.service}`,
        `Scenario: ${active.scenario}`,
        `Expected: ${active.expectedCode} ${active.expectedMessage}`.trim(),
        `Result: ${verdict ?? "-"}`,
        `RRN / referenceNo: ${lastTxn.referenceNo || "-"}`,
        `X-EXTERNAL-ID: ${lastTxn.externalId || "-"}`,
        `partnerReferenceNo: ${lastTxn.partnerReferenceNo || "-"}`,
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
                        <p className="text-[10px] uppercase tracking-[0.2em] text-indigo-400">Internal sandbox</p>
                        <h1 className="mt-1 text-xl font-semibold">Yokke QR Test Cases</h1>
                        <p className="mt-2 text-xs text-slate-400">
                            {defaults.isProduction ? "Production" : "Yokke sandbox"} · MID {defaults.merchantId || "—"} · TID{" "}
                            {defaults.terminalId || "—"}
                        </p>
                        {!defaults.configured ? (
                            <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                                Yokke env vars are incomplete. Generate/Check will fail until they are set.
                            </p>
                        ) : null}

                        <div className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
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
                            </div>
                        </div>
                        <p className="mt-3 text-xs text-slate-400">{active.notes}</p>
                    </div>

                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                        <div className="space-y-5">
                            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-lg font-semibold">Request editor</h3>
                                        <p className="text-xs text-slate-400">
                                            Edit JSON, then run Generate or Check. Selecting a test case prefills the payload.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => run("generate")}
                                            disabled={busy !== null}
                                            className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50"
                                        >
                                            {busy === "generate" ? "Generating…" : "Generate QR"}
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
                                        Store pending payment (so notify can match)
                                    </label>
                                </div>

                                <div className="grid gap-4 lg:grid-cols-2">
                                    <JsonField
                                        id="generate-body"
                                        label="Generate request body"
                                        hint="POST /v2.0/qr/qr-mpm-generate"
                                        value={generateBody}
                                        onChange={setGenerateBody}
                                    />
                                    <JsonField
                                        id="query-body"
                                        label="Check / inquiry request body"
                                        hint="POST /v2.0/qr/qr-mpm-query — auto-filled after generate"
                                        value={queryBody}
                                        onChange={setQueryBody}
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
                                        <dt className="text-slate-500">sandbox uuid</dt>
                                        <dd className="break-all text-right font-mono text-slate-200">{lastTxn.uuid || "—"}</dd>
                                    </div>
                                </dl>
                                <p className="mt-4 text-xs text-slate-500">
                                    Payment notify hits <code className="text-slate-300">/memento/pay/qr/qr-mpm-notify</code> and
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
