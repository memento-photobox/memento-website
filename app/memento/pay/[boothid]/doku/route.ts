import { db } from "@/utils/supabase/server";
import { createHash, createHmac, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { toGmt7OffsetISOString } from "@/app/lib/timezone";


const checkoutV1Payment = "/checkout/v1/payment";
const DOKU_API_CHECKOUT_URL = process.env.DOKU_API_URL + checkoutV1Payment;
const DOKU_CLIENT_ID = process.env.DOKU_CLIENT_ID;
const DOKU_SECRET_KEY = process.env.DOKU_SECRET_KEY;
// Sample Req Header
// Client-Id: MCH-0001-10791114622547
// Request-Id: fdb69f47-96da-499d-acec-7cdc318ab2fe
// Request-Timestamp: 2020-08-11T08:45:42Z
// Signature: HMACSHA256=1jap2tpgvWt83tG4J7IhEwUrwmMt71OaIk0oL0e6sPM=

export async function POST(req: Request) {
    const split = req.url.split("/");
    const boothid = split[split.length - 2];
    const uuid = randomUUID();
    try {
        console.log("getPayment called with boothid:", boothid, "uuid:", uuid);
        const data = await getPayment(boothid, uuid);
        console.log("Doku Payment:", data);
        return NextResponse.json({success: true, data: data});
    } catch (error) {
        console.error("Error in Doku Payment:", error);
        return NextResponse.json({success: false, error: error});
    }
}
async function getPayment(boothid: string, uuid: string): Promise<DokuCheckoutResponse> {
    const orderId = `${boothid}:${uuid}`;
    const price = await getPriceByBoothId(boothid);
    // const price = 100; // hardcode for testing

    const dokuReq = getBody(price, orderId);
    const headers = getHeaders(uuid, dokuReq);

    const res = await fetch(DOKU_API_CHECKOUT_URL!, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(dokuReq),
    });
    if (!res.ok) {
        const error = await res.json();
        console.error("Error:", error);
        throw new Error(error.message || "Failed to get token");
    }
    const data: DokuCheckoutResponse = await res.json();
    console.log("Data", data);
    return data;
}

function getBody(price: number, orderId: string): DokuCheckoutRequest {
    return {
        "order": {
            "amount": price,
            "invoice_number": orderId,
            "auto_redirect": false,
            // "callback_url": "/step?order_id=" + orderId 
        },
        "payment": {
            "payment_due_date": 60,
            "payment_method_types": ["QRIS"]
        }
    }
}

function getTimestamp() {
    return toGmt7OffsetISOString(new Date(), { includeMilliseconds: false });
}

function getSignature(clientId: string, reqId: string, reqTimestamp: string, jsonBody: DokuCheckoutRequest): string {
    console.log("jsonBody:", jsonBody);
    const digest = createHash("sha256").update(JSON.stringify(jsonBody), "utf-8").digest("base64");
    const data = `Client-Id:${clientId}\nRequest-Id:${reqId}\nRequest-Timestamp:${reqTimestamp}\nRequest-Target:${checkoutV1Payment}\nDigest:${digest}`;
    const hmac = createHmac('sha256', DOKU_SECRET_KEY!).update(data, 'utf8').digest('base64');
    const signature = `HMACSHA256=${hmac}`;
    return signature
}

function getHeaders(requestId: string, jsonBody: DokuCheckoutRequest) {
    const clientId = DOKU_CLIENT_ID!;
    const timestamp = getTimestamp();
    const signature = getSignature(clientId, requestId, timestamp, jsonBody);
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Client-Id": clientId,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        "Signature": signature,
    }
}

async function getPriceByBoothId(boothid: string) {
    const supabase = await db();
    const { data, error } = await supabase
        .from("booth")
        .select("price")
        .eq("id", boothid)
        .single();
    if (error || !data) {
        // fallback to default price
        console.warn(`No price found for booth ${boothid}, using default price`);
        return 38001;
    }
    return data.price;
}

type DokuCheckoutRequest = {
    order: {
        amount: number,
        invoice_number: string,
        auto_redirect: boolean,
        callback_url?: string,
    },
    payment: {
        payment_due_date: number,
        payment_method_types: string[]
    }
}

type DokuCheckoutResponse = {
    message: string[],
    response: {
        order: {
            amount: string,
            invoice_number: string,
            currency: string,
            session_id: string
        },
        payment: {
            payment_method_types: string[],
            payment_due_date: number,
            token_id: string,
            url: string,
            expired_date: string
        },
        additional_info: {
            origin: {
                product: string,
                system: string,
                apiFormat: string,
                source: string
            }
        },
        uuid: number,
        headers: {
            request_id: string,
            signature: string,
            date: string,
            client_id: string
        }
    }
}
