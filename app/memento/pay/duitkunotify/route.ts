import { db } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { Memento } from "../../types";
import { env } from "@/app/env";
import { extractOrderId } from "../../utils";
import crypto from "crypto";
import { checkAndSendNoticePrint } from "../notice-check";

type DuitkuNotificationRequest = {
    merchantCode: string,
    amount: string,
    merchantOrderId: string,
    productDetail: string,
    additionalParam: string,
    paymentCode: string,
    resultCode: string,
    merchantUserId: string,
    reference: string,
    signature: string,
    publisherOrderId: string,
    spUserHash: string,
    settlementDate: string,
    issuerCode: string,
}

// SHA512(order_id+status_code+gross_amount+serverKey)
function isNotificationSafe(notification: DuitkuNotificationRequest) {
    const { resultCode, signature, merchantCode, amount, merchantOrderId } = notification;
    if(resultCode !== "00") return false;
    const merchantKey = env.duitkuAPIKey;

    // MD5(merchantcode + amount + merchantOrderId + merchantKey)
    const hash = crypto.createHash("md5");
    hash.update(merchantCode + amount + merchantOrderId + merchantKey);
    const hashString = hash.digest("hex");

    if(hashString !== signature) {
        console.log("Signature mismatch", hashString, signature);
        return false;
    }

    return true;
}

async function processPayment(request: Request) {
    const body: DuitkuNotificationRequest = await request.json();
    console.log("Payment", body);
    if(!isNotificationSafe(body)) {
        throw new Error("Not a valid notification");
    }
    const revenue = body.amount
    const additional = body.publisherOrderId || "";
    const [boothid, uuid] = extractOrderId(body.merchantOrderId);
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