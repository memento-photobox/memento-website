/**
 * POST /memento/pay/yokke/v2/notify
 *
 * v2 — Production callback URL registered with Yokke (QR Payment Credit Notify).
 * Shares the exact same handler as /memento/pay/qr/qr-mpm-notify (v1), which is
 * kept alive for sandbox / existing test flows.
 */
import { POST as notifyHandler } from "../../../qr/qr-mpm-notify/route";

export async function POST(request: Request) {
    console.log("[yokke v2] notify hit: /memento/pay/yokke/v2/notify");
    return notifyHandler(request);
}
