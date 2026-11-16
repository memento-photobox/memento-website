import { NextResponse } from "next/server";
import {
    GENERATE_PATH,
    QUERY_PATH,
    callYokkeApi,
    generateExternalId,
    generatePartnerRef,
    getAllEnvDefaults,
    getEnvConfig,
    getTimestamp,
    todayYyyymmdd,
    type YokkeCallOptions,
    type YokkeEnvMode,
} from "../../lib/yokke";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const modeParam = searchParams.get("mode");
    const envDefaults = getAllEnvDefaults();
    const mode: YokkeEnvMode = modeParam === "prod" || modeParam === "sandbox" ? modeParam : envDefaults.defaultMode;

    return NextResponse.json({
        success: true,
        defaults: getEnvConfig(mode),
        envDefaults,
        helpers: {
            timestamp: getTimestamp(),
            externalId: generateExternalId(),
            partnerReferenceNo: generatePartnerRef(),
            originalTransactionDate: todayYyyymmdd(),
            generatePath: GENERATE_PATH,
            queryPath: QUERY_PATH,
        },
    });
}

type YokkeActionBody = {
    action?: "generate" | "query";
    mode?: YokkeEnvMode;
    body?: Record<string, unknown>;
    options?: YokkeCallOptions;
};

export async function POST(request: Request) {
    let payload: YokkeActionBody;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const action = payload.action === "query" ? "query" : "generate";
    const path =
        action === "query"
            ? payload.options?.queryPath || QUERY_PATH
            : GENERATE_PATH;
    const mode: YokkeEnvMode =
        payload.mode === "prod" || payload.options?.mode === "prod"
            ? "prod"
            : payload.mode === "sandbox" || payload.options?.mode === "sandbox"
              ? "sandbox"
              : getAllEnvDefaults().defaultMode;

    const defaults = getEnvConfig(mode);

    if (!defaults.configured) {
        return NextResponse.json(
            {
                success: false,
                error: `Yokke ${mode.toUpperCase()} credentials are not configured in environment variables`,
            },
            { status: 500 },
        );
    }

    const body = payload.body ?? {};
    const options = payload.options ?? {};

    try {
        const result = await callYokkeApi(path, body, {
            ...options,
            mode,
            storePending: action === "generate" ? options.storePending !== false : false,
        });

        return NextResponse.json({
            success: true,
            action,
            path,
            envConfig: defaults,
            ...result,
        });
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}
