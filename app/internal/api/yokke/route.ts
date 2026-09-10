import { NextResponse } from "next/server";
import {
    GENERATE_PATH,
    QUERY_PATH,
    callYokkeApi,
    generateExternalId,
    generatePartnerRef,
    getSandboxDefaults,
    getTimestamp,
    todayYyyymmdd,
    type YokkeCallOptions,
} from "../../lib/yokke";

export async function GET() {
    return NextResponse.json({
        success: true,
        defaults: getSandboxDefaults(),
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
    const defaults = getSandboxDefaults();

    if (!defaults.configured) {
        return NextResponse.json(
            { success: false, error: "Yokke credentials are not configured in environment variables" },
            { status: 500 },
        );
    }

    const body = payload.body ?? {};
    const options = payload.options ?? {};

    try {
        const result = await callYokkeApi(path, body, {
            ...options,
            storePending: action === "generate" ? options.storePending !== false : false,
        });

        return NextResponse.json({
            success: true,
            action,
            path,
            ...result,
        });
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}
