import { db } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { Memento } from "../../types";
import { env } from "@/app/env";
import { sha512 } from "js-sha512";
import { extractOrderId } from "../../utils";
import { checkAndSendNoticePrint } from "../notice-check";

type MidtransNotificationRequest = {
    // order_id+status_code+gross_amount+ServerKey
    order_id: string,
    status_code: string,
    gross_amount: string,
    signature_key: string,
    transaction_status: string,
    fraud_status: string,
    additional: string,
    transaction_id: string,
}

// SHA512(order_id+status_code+gross_amount+serverKey)
function isNotificationSafe(notification: MidtransNotificationRequest) {
    const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = notification;
    console.log(fraud_status)
    if(fraud_status !== "accept") return false;
    console.log(transaction_status)
    if(!(transaction_status === "capture" || transaction_status === "settlement")) return false;
    
    const serverKey = env.midtransServerKey;
    const hash = sha512(order_id + status_code + gross_amount + serverKey);
    console.log([hash, signature_key]);
    if (hash !== signature_key) return false;

    return true;
}

async function processPayment(request: Request) {
    const body: MidtransNotificationRequest = await request.json();
    console.log("Payment", body);
    if(!isNotificationSafe(body)) {
        throw new Error("Not a valid notification");
    }
    const revenue = body.gross_amount
    const additional = body.transaction_id || "";
    const [boothid, uuid] = extractOrderId(body.order_id);
    console.log("savePayment", revenue, additional, uuid);
    const data = await savePayment(revenue, additional, uuid, boothid);
    return data;
}

async function savePayment(revenue: string, additional: string, uuid: string, boothid: string): Promise<Memento> {
    const supabase = await db();
    const { data, error } = await supabase
        .from("memento")
        .insert({
            revenue: revenue,
            additional: additional,
            uuid: uuid,
            boothid: boothid
        })
        .select()
    if (error) throw error;
    return data[0];
}

// payment stuff
// called by Payment Gateway API after payment successful
export async function POST(request: Request) {
    try {
        const data = await processPayment(request);
        await checkAndSendNoticePrint(data.boothid);
        return NextResponse.json({ success: true, data: data });    
    } catch (e) {
        return NextResponse.json({ success: false, error: e }, { status: 400 });
    }
}