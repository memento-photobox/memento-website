import { db } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { Memento } from "../../types";
import { checkAndSendNoticePrint } from "../notice-check";


const DOKU_WEBHOOK_SECRET = process.env.DOKU_WEBHOOK_SECRET;

export async function POST(req: Request) {
    const url = new URL(req.url);
    const secret = url.searchParams.get('secret'); // in the future, verify signature with proper way. This is done like this because at the time of writing, Doku sandbox doesn't work properly, the qris is also bugged. We have to directly do the risky move with production. So for now just use something that definitely works but still secure.
    console.log("Doku Webhook Secret", secret);
    console.log("Expected Secret", DOKU_WEBHOOK_SECRET);
    if (secret !== DOKU_WEBHOOK_SECRET) {
        return NextResponse.json({success: false, error: "Unauthorized"}, {status: 401});
    }

    try {
        const body: DokuWebhookPayload = await req.json();
        console.log("Doku Webhook", body);
        const [boothid, uuid] = body.order.invoice_number.split(":");
        const revenue = body.order.amount.toString();
        const additional = body.emoney_payment.account_id || "";
        console.log("savePayment", revenue, additional, uuid, boothid);
        const data = await savePayment(revenue, additional, uuid, boothid);
        console.log("Saved payment", data);
        await checkAndSendNoticePrint(boothid);
        return NextResponse.json({success: true, data: data});
    } catch(e) {
        console.error("Error in Doku Webhook:", e);
        return NextResponse.json({success: false, error: e}, {status: 400});
    }
}

async function savePayment(revenue: string, additional: string, uuid: string, boothid: string): Promise<Memento> {
    const supabase = await db();
    const { data, error } = await supabase
        .from("memento")
        .upsert({
            revenue: revenue,
            additional: additional,
            uuid: uuid,
            boothid: boothid,
            is_paid: true,
        }, { onConflict: 'uuid' })
        .select()
    if (error) throw error;
    return data[0];
}



type DokuWebhookPayload = {
    service: {
        id: string,
        name: string
    },
    acquirer: {
        id: string,
        name: string
    },
    channel: {
        id: string,
        name: string
    },
    customer: {
        doku_id: string,
        name: string,
        email: string,
        phone: string
    },
    order: {
        invoice_number: string, // boothid:uuid
        amount: number
    },
    emoney_payment: {
        account_id: string,
        approval_code: string
    },
    transaction: {
        status: string,
        date: string
    },
    additional_info: {
        postalCode: string,
        feeType: string,
        settlement: {
            bank_account_settlement_id: string,
            value: number,
            type: string
        }[],
        origin: {
            product: string,
            system: string,
            apiFormat: string,
            source: string
        }
    }
}
