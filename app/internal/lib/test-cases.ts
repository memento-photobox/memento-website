export type TestAction = "generate" | "query";

export type SandboxDefaults = {
    merchantId: string;
    terminalId: string;
    partnerId: string;
    channelId: string;
    isProduction: boolean;
    configured: boolean;
};

export type TestCasePreset = {
    generateBody?: Record<string, unknown>;
    queryBody?: Record<string, unknown>;
    options?: {
        invalidToken?: boolean;
        invalidSignature?: boolean;
        omitChannelId?: boolean;
        channelId?: string;
        externalId?: string;
        storePending?: boolean;
    };
};

export type YokkeTestCase = {
    id: string;
    no: string;
    group: "QR Generation" | "QR Credit / Notify" | "Query Payment" | "Auth / Validation";
    method: "On us" | "Off us" | "Any";
    type: "Positive" | "Negative" | "Manual";
    service: string;
    scenario: string;
    expectedCode: string;
    expectedMessage: string;
    action: TestAction;
    steps: string;
    notes: string;
};

export const YOKKE_TEST_CASES: YokkeTestCase[] = [
    {
        id: "gen-success",
        no: "1",
        group: "QR Generation",
        method: "On us",
        type: "Positive",
        service: "QR generation",
        scenario: "QR Generation Success",
        expectedCode: "2004700",
        expectedMessage: "Successful",
        action: "generate",
        steps: "Generate QR with valid merchantId, terminalId, and amount. Copy request/response into the form. Scan the QR to continue payment cases.",
        notes: "Happy path. Capture RRN / referenceNo from the generate response.",
    },
    {
        id: "gen-timeout",
        no: "2",
        group: "QR Generation",
        method: "On us",
        type: "Negative",
        service: "QR generation",
        scenario: "QR Generation timeout",
        expectedCode: "5044700",
        expectedMessage: "Timeout",
        action: "generate",
        steps: "Send a generate request and record if Yokke times out (5044700). Timeout cannot be forced from this sandbox.",
        notes: "Depends on Yokke sandbox latency. Re-run if the call succeeds instead of timing out.",
    },
    {
        id: "gen-invalid-mid",
        no: "3",
        group: "QR Generation",
        method: "On us",
        type: "Negative",
        service: "QR generation",
        scenario: "Invalid MID",
        expectedCode: "4044708",
        expectedMessage: "Invalid Merchant",
        action: "generate",
        steps: "Generate with merchantId 000000000000000 (invalid MID).",
        notes: "Preset already swaps in an invalid merchantId.",
    },
    {
        id: "gen-invalid-tid",
        no: "4",
        group: "QR Generation",
        method: "On us",
        type: "Negative",
        service: "QR generation",
        scenario: "Invalid TID",
        expectedCode: "4044717",
        expectedMessage: "Invalid Terminal",
        action: "generate",
        steps: "Generate with terminalId 00000000 (invalid TID).",
        notes: "Preset already swaps in an invalid terminalId.",
    },
    {
        id: "credit-normal",
        no: "5",
        group: "QR Credit / Notify",
        method: "On us",
        type: "Positive",
        service: "QR Credit",
        scenario: "Normal payment",
        expectedCode: "2005200",
        expectedMessage: "Successful",
        action: "generate",
        steps: "1) Generate a valid QR. 2) Pay it from the issuer app. 3) Click Check Status. Notify (service 52) should return 2005200; inquiry should show latestTransactionStatus 00.",
        notes: "2005200 is the Payment Notify response from /memento/pay/qr/qr-mpm-notify. Check Status shows the inquiry (51) payload.",
    },
    {
        id: "credit-timeout",
        no: "6",
        group: "QR Credit / Notify",
        method: "On us",
        type: "Negative",
        service: "QR Credit",
        scenario: "Payment Timeout",
        expectedCode: "6",
        expectedMessage: "",
        action: "generate",
        steps: "Generate QR, start payment, then let the issuer/acquirer time out. Click Check Status to capture the inquiry result.",
        notes: "Error code 6 is issuer-side. This sandbox cannot force the timeout.",
    },
    {
        id: "credit-double",
        no: "7",
        group: "QR Credit / Notify",
        method: "On us",
        type: "Negative",
        service: "QR Credit",
        scenario: "Double payment with same QR",
        expectedCode: "2005200",
        expectedMessage: "Successful",
        action: "generate",
        steps: "Generate one QR, pay it, then try to pay the same QR again. First notify is 2005200 Successful; record the second attempt.",
        notes: "Keep the same QR on screen. Do not generate a new one between attempts.",
    },
    {
        id: "credit-expired",
        no: "8",
        group: "QR Credit / Notify",
        method: "On us",
        type: "Negative",
        service: "QR Credit",
        scenario: "Payment QR Expired",
        expectedCode: "2005200",
        expectedMessage: "Successful",
        action: "generate",
        steps: "Generate QR, wait until it expires, then attempt payment / notify. Click Check Status afterwards.",
        notes: "Expiry is controlled by Yokke. Wait, then try to pay the same QR.",
    },
    {
        id: "notify-success",
        no: "9",
        group: "QR Credit / Notify",
        method: "On us",
        type: "Positive",
        service: "QR Credit",
        scenario: "Purchase Notify (Payment success)",
        expectedCode: "2005200",
        expectedMessage: "Successful",
        action: "generate",
        steps: "Generate QR and pay it. Yokke calls POST /memento/pay/qr/qr-mpm-notify. Our handler returns 2005200 Successful. Click Check Status to confirm inquiry status 00.",
        notes: "Notify request is sent by Yokke to this website. Check Status is the inquiry you can capture here.",
    },
    {
        id: "notify-expired",
        no: "10",
        group: "QR Credit / Notify",
        method: "On us",
        type: "Negative",
        service: "QR Credit",
        scenario: "Purchase Notify (payment fail QR expired)",
        expectedCode: "2005200",
        expectedMessage: "Successful",
        action: "generate",
        steps: "Generate QR, let it expire, trigger a failed/expired notify. Our notify route still acknowledges with 200 when status is not 00.",
        notes: "Handler ignores non-00 latestTransactionStatus and still replies Successful so Yokke does not retry.",
    },
    {
        id: "notify-timeout",
        no: "11",
        group: "QR Credit / Notify",
        method: "On us",
        type: "Negative",
        service: "QR Credit",
        scenario: "Purchase Notify timeout",
        expectedCode: "6",
        expectedMessage: "",
        action: "generate",
        steps: "Generate QR and wait for a notify timeout from Yokke. Capture whatever Check Status returns.",
        notes: "Timeout is on Yokke's notify delivery, not this sandbox.",
    },
    {
        id: "query-success",
        no: "12",
        group: "Query Payment",
        method: "On us",
        type: "Positive",
        service: "QR Credit",
        scenario: "Check status sukses / inquiry",
        expectedCode: "2005100",
        expectedMessage: "Successful",
        action: "query",
        steps: "Generate a QR first (or reuse the last one), then click Check Status. Inquiry uses originalReferenceNo + originalExternalId from generate.",
        notes: "Pending unpaid QR should still return 2005100 with a pending transaction status.",
    },
    {
        id: "query-not-found",
        no: "13",
        group: "Query Payment",
        method: "On us",
        type: "Negative",
        service: "QR Credit",
        scenario: "Check Status Transaksi Not Found",
        expectedCode: "4045101",
        expectedMessage: "Transaction Not Found",
        action: "query",
        steps: "Click Check Status with a non-existent originalReferenceNo (preset fills a fake ref).",
        notes: "Some environments return 4045103 instead of 4045101 — record the actual code.",
    },
    {
        id: "query-pending",
        no: "15",
        group: "Query Payment",
        method: "On us",
        type: "Positive",
        service: "Query Payment",
        scenario: "Pending Transaction / inquiry",
        expectedCode: "2005100",
        expectedMessage: "Successful",
        action: "query",
        steps: "Generate a QR and do not pay it. Click Check Status immediately to capture the pending inquiry.",
        notes: "Use the last generated reference. Scenario: inquiry before payment.",
    },
    {
        id: "query-missing",
        no: "16",
        group: "Query Payment",
        method: "On us",
        type: "Negative",
        service: "Query Payment",
        scenario: "Transaction Not Found",
        expectedCode: "4045101",
        expectedMessage: "Transaction Not Found",
        action: "query",
        steps: "Check Status with a reference that was never generated.",
        notes: "Same as TC 13 — useful for the Query Payment sheet.",
    },
    {
        id: "auth-invalid-token",
        no: "A1",
        group: "Auth / Validation",
        method: "Any",
        type: "Negative",
        service: "Any Service",
        scenario: "Access Token Invalid",
        expectedCode: "401xx01",
        expectedMessage: "Access Token Invalid",
        action: "generate",
        steps: "Send generate with Bearer token INVALID_ACCESS_TOKEN_FOR_TESTING.",
        notes: "Preset enables invalidToken.",
    },
    {
        id: "auth-invalid-sig",
        no: "A2",
        group: "Auth / Validation",
        method: "Any",
        type: "Negative",
        service: "Any Service",
        scenario: "Unauthorized Signature",
        expectedCode: "401xx00",
        expectedMessage: "Unauthorized Signature",
        action: "generate",
        steps: "Send generate with an invalid X-SIGNATURE.",
        notes: "Preset enables invalidSignature.",
    },
];

export function buildPreset(tc: YokkeTestCase, defaults: SandboxDefaults, last?: {
    referenceNo?: string;
    externalId?: string;
    partnerReferenceNo?: string;
}): TestCasePreset {
    const now = Date.now().toString();
    const partnerReferenceNo = `${now.slice(0, 8)}${now.slice(-12)}`.slice(0, 20);
    const generateBody: Record<string, unknown> = {
        partnerReferenceNo,
        amount: { value: "10000.00", currency: "IDR" },
        feeAmount: { value: "0.00", currency: "IDR" },
        merchantId: defaults.merchantId,
        terminalId: defaults.terminalId,
    };

    const queryBody: Record<string, unknown> = {
        originalReferenceNo: last?.referenceNo || "NONEXISTENT_REF_999999",
        originalExternalId: last?.externalId || "000000000000000",
        serviceCode: "47",
        merchantId: defaults.merchantId,
        additionalInfo: {
            originalTransactionDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
            terminalId: defaults.terminalId,
        },
    };

    switch (tc.id) {
        case "gen-invalid-mid":
            generateBody.merchantId = "000000000000000";
            return { generateBody, options: { storePending: false } };
        case "gen-invalid-tid":
            generateBody.terminalId = "00000000";
            return { generateBody, options: { storePending: false } };
        case "query-not-found":
        case "query-missing":
            queryBody.originalReferenceNo = "NONEXISTENT_REF_999999";
            queryBody.originalExternalId = "000000000000001";
            return { queryBody, options: {} };
        case "auth-invalid-token":
            return { generateBody, options: { invalidToken: true, storePending: false } };
        case "auth-invalid-sig":
            return { generateBody, options: { invalidSignature: true, storePending: false } };
        default:
            if (tc.action === "query") {
                return { queryBody, options: {} };
            }
            return { generateBody, options: { storePending: true } };
    }
}

export function matchExpected(expectedCode: string, actualCode: string | undefined): boolean {
    if (!actualCode) return false;
    if (expectedCode.includes("xx")) {
        const [prefix, suffix] = expectedCode.split("xx");
        return actualCode.startsWith(prefix) && actualCode.endsWith(suffix);
    }
    return actualCode === expectedCode;
}
