import { NextRequest, NextResponse } from "next/server";

const INTERNAL_USER = process.env.INTERNAL_BASIC_USER ?? "memento";
const INTERNAL_PASS = process.env.INTERNAL_BASIC_PASS ?? "JoseMando2026";

function unauthorized(realm: string) {
    return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": `Basic realm="${realm}"` },
    });
}

function isValidBasicAuth(authHeader: string | null, user: string, pass: string) {
    const expected = Buffer.from(`${user}:${pass}`).toString("base64");
    return authHeader === `Basic ${expected}`;
}

export function middleware(request: NextRequest) {
    if (request.method === "OPTIONS") {
        return new Response("ok", { status: 200 });
    }

    const pathname = request.nextUrl.pathname;

    if (pathname === "/internal" || pathname.startsWith("/internal/")) {
        const authHeader = request.headers.get("authorization");
        if (!isValidBasicAuth(authHeader, INTERNAL_USER, INTERNAL_PASS)) {
            return unauthorized("Memento Internal");
        }
        return NextResponse.next();
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Basic ${process.env.BASIC_AUTH_SECRET}`) {
        return new Response("Unauthorized", {
            status: 401,
        });
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        "/internal",
        "/internal/:path*",
        "/memento/:uuid/check",
        "/memento/:uuid/upload",
        // '/memento/cron/notify', // different env var
        // '/memento/cron/cleanup', // different env var
        "/memento/pay",
        "/memento/pay/:boothid/status",
        "/memento/pay/:boothid/doku",

        "/memento/config/filter",
        "/memento/config/template",

        "/memento/template",

        "/memento/admin/memento/forcepay",
    ],
}