#!/usr/bin/env node
/**
 * YOKKE API Test Automation Script
 * =================================
 * Runs test cases against YOKKE SNAP API endpoints and outputs results to CSV.
 *
 * Usage:
 *   node yokke-api-test.mjs
 *
 * Reads environment from .env in the same directory.
 * Outputs: yokke-test-results-<timestamp>.csv
 */

import { createSign, createHmac, createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ─── Load .env manually (no dotenv dependency needed) ────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = resolve(__dirname, ".env");
  const content = readFileSync(envPath, "utf-8");
  const env = {};
  let currentKey = null;
  let currentValue = "";
  let inMultiline = false;

  for (const line of content.split("\n")) {
    if (inMultiline) {
      currentValue += "\n" + line;
      // Check if this line ends the multiline value
      if (line.includes('"') && !line.startsWith('"')) {
        // End of multiline
        const trimmed = currentValue.replace(/^"|"$/g, "");
        env[currentKey] = trimmed;
        inMultiline = false;
        currentKey = null;
        currentValue = "";
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    let val = trimmed.substring(eqIdx + 1).trim();

    // Check for multiline value (starts with quote but doesn't end with one on same line)
    if (val.startsWith('"') && !val.endsWith('"')) {
      currentKey = key;
      currentValue = val;
      inMultiline = true;
      continue;
    }

    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }

  return env;
}

const ENV = loadEnv();

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = "https://tst.yokke.co.id:7778";
const TOKEN_PATH = "/qr/v2.0/access-token/b2b";
const GENERATE_PATH = "/v2.0/qr/qr-mpm-generate";
const QUERY_PATH = "/v2.0/qr/qr-mpm-query";
const CANCEL_PATH = "/v2.0/qr/qr-mpm-cancel";

const CLIENT_KEY = ENV.YOKKE_CLIENT_KEY;
const PRIVATE_KEY = ENV.YOKKE_PRIVATE_KEY;
const CLIENT_SECRET = ENV.YOKKE_CLIENT_SECRET;
const PARTNER_ID = ENV.YOKKE_PARTNER_ID;
const CHANNEL_ID = ENV.YOKKE_CHANNEL_ID || "02";
const MERCHANT_ID = (ENV.YOKKE_MERCHANT_ID || "").padStart(15, "0");
const TERMINAL_ID = ENV.YOKKE_TERMINAL_ID;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTimestamp() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  const H = String(wib.getUTCHours()).padStart(2, "0");
  const M = String(wib.getUTCMinutes()).padStart(2, "0");
  const S = String(wib.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${H}:${M}:${S}+07:00`;
}

function generateExternalId() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const mo = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  const millis = (Date.now() % 10000).toString().padStart(4, "0");
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${y}${mo}${d}${millis}${rand}`;
}

function generatePartnerRef() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const mo = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  const millis = (Date.now() % 100000).toString().padStart(5, "0");
  const rand = Math.floor(Math.random() * 10000000).toString().padStart(7, "0");
  return `${y}${mo}${d}${millis}${rand}`;
}

/** RSA SHA256 signature for access token endpoint */
function buildTokenSignature(clientKey, timestamp) {
  const signer = createSign("SHA256");
  signer.update(`${clientKey}|${timestamp}`);
  return signer.sign(PRIVATE_KEY, "base64");
}

/** HMAC-SHA512 signature for API calls */
function buildApiSignature(method, endpointPath, accessToken, body, timestamp) {
  const bodyHash = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex")
    .toLowerCase();
  const stringToSign = [method, endpointPath, accessToken, bodyHash, timestamp].join(":");
  return createHmac("sha512", CLIENT_SECRET).update(stringToSign).digest("base64");
}

// ─── Get Access Token ────────────────────────────────────────────────────────

async function getAccessToken() {
  const timestamp = getTimestamp();
  const signature = buildTokenSignature(CLIENT_KEY, timestamp);

  const headers = {
    "Content-Type": "application/json",
    "X-CLIENT-KEY": CLIENT_KEY,
    "X-TIMESTAMP": timestamp,
    "X-SIGNATURE": signature,
    "X-PLATFORM": "PORTAL",
  };

  const reqBody = { grantType: "client_credentials" };

  const res = await fetch(`${BASE_URL}${TOKEN_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(reqBody),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.accessToken) {
    throw new Error(`Failed to get access token: ${JSON.stringify(data)}`);
  }

  return data.accessToken;
}

// ─── Generic API Call ────────────────────────────────────────────────────────

/**
 * Makes an API call and returns { requestObj, responseObj, httpStatus }
 * All error statuses are captured (no throw), so we can record everything.
 */
async function callApi({
  method = "POST",
  path,
  body,
  accessToken,
  externalId,
  overrideHeaders = {},
  skipSignature = false,
  invalidSignature = false,
}) {
  const timestamp = getTimestamp();

  let signature = "";
  if (!skipSignature) {
    if (invalidSignature) {
      signature = "INVALID_SIGNATURE_FOR_TESTING_aAbBcCdDeEfFgGhH==";
    } else {
      signature = buildApiSignature(method, path, accessToken, body, timestamp);
    }
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${accessToken}`,
    "X-TIMESTAMP": timestamp,
    "X-SIGNATURE": signature,
    "X-EXTERNAL-ID": externalId,
    "X-PARTNER-ID": PARTNER_ID,
    "CHANNEL-ID": CHANNEL_ID,
    ...overrideHeaders,
  };

  const requestObj = {
    method,
    url: `${BASE_URL}${path}`,
    headers: { ...headers },
    body,
  };

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });

    let responseBody;
    const responseText = await res.text();
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = { rawText: responseText };
    }

    return {
      requestObj,
      responseObj: responseBody,
      httpStatus: res.status,
    };
  } catch (err) {
    return {
      requestObj,
      responseObj: { error: err.message },
      httpStatus: 0,
    };
  }
}

// ─── Build default QR Generate body ──────────────────────────────────────────

function buildGenerateBody(overrides = {}) {
  return {
    partnerReferenceNo: generatePartnerRef(),
    amount: { value: "10000.00", currency: "IDR" },
    feeAmount: { value: "0.00", currency: "IDR" },
    merchantId: MERCHANT_ID,
    terminalId: TERMINAL_ID,
    ...overrides,
  };
}

function buildQueryBody(overrides = {}) {
  return {
    originalReferenceNo: overrides.originalReferenceNo || "REF123456",
    originalExternalId: overrides.originalExternalId || generateExternalId(),
    serviceCode: "47",
    merchantId: MERCHANT_ID,
    additionalInfo: {
      originalTransactionDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      terminalId: TERMINAL_ID,
    },
    ...overrides,
  };
}

function buildCancelBody(overrides = {}) {
  return {
    originalReferenceNo: overrides.originalReferenceNo || "REF123456",
    originalExternalId: overrides.originalExternalId || generateExternalId(),
    merchantId: MERCHANT_ID,
    reason: overrides.reason || "Customer request cancel",
    additionalInfo: {
      terminalId: TERMINAL_ID,
    },
    ...overrides,
  };
}

// ─── Test Cases ──────────────────────────────────────────────────────────────

async function runAllTests() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  YOKKE API Test Automation");
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Step 0: Get a valid access token for reuse
  console.log("🔑 Acquiring valid access token...");
  let validToken;
  try {
    validToken = await getAccessToken();
    console.log(`✅ Access token acquired: ${validToken.substring(0, 15)}...\n`);
  } catch (err) {
    console.error("❌ Failed to acquire access token:", err.message);
    console.error("Cannot proceed with tests. Please check your .env credentials.\n");
    process.exit(1);
  }

  const results = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #1: Access Token Invalid (Any Service)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #1: Access Token Invalid ━━━");
  {
    const externalId = generateExternalId();
    const body = buildGenerateBody();
    const invalidToken = "INVALID_ACCESS_TOKEN_FOR_TESTING";

    // Rebuild signature with invalid token so only the token is the error source
    const { requestObj, responseObj, httpStatus } = await callApi({
      path: GENERATE_PATH,
      body,
      accessToken: invalidToken,
      externalId,
    });

    const expectedCode = "401";
    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode.startsWith("401") && responseCode.includes("01");

    results.push({
      no: 1,
      service: "Any Service (QR MPM Generate)",
      scenario: "Access Token Invalid",
      expectedResult: `Error Code: 401xx01\nError Message: "Access Token Invalid"`,
      step: "Kirim request dengan Bearer token tidak valid",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Sent invalid bearer token. responseCode=${responseCode}, responseMessage=${responseMessage}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #2: Unauthorized Signature (Any Service)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #2: Unauthorized Signature ━━━");
  {
    const externalId = generateExternalId();
    const body = buildGenerateBody();

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: GENERATE_PATH,
      body,
      accessToken: validToken,
      externalId,
      invalidSignature: true,
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode.startsWith("401") && responseCode.includes("00");

    results.push({
      no: 2,
      service: "Any Service (QR MPM Generate)",
      scenario: "Unauthorized . Signature",
      expectedResult: `Error Code: 401xx00\nError Message: "Unauthorized Signature"`,
      step: "Kirim request dengan X-SIGNATURE yang salah/invalid",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Sent invalid signature. responseCode=${responseCode}, responseMessage=${responseMessage}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #3: Invalid Mandatory Field (Any Service)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #3: Invalid Mandatory Field ━━━");
  {
    const externalId = generateExternalId();
    // Remove channelId from body - but CHANNEL-ID is a header field
    // Remove a mandatory body field instead: merchantId
    const body = buildGenerateBody();
    delete body.merchantId;

    // Also test missing CHANNEL-ID header
    const { requestObj, responseObj, httpStatus } = await callApi({
      path: GENERATE_PATH,
      body,
      accessToken: validToken,
      externalId,
      overrideHeaders: {
        // Optionally remove CHANNEL-ID by setting empty
      },
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode.includes("400") && responseCode.includes("02");

    results.push({
      no: 3,
      service: "Any Service (QR MPM Generate)",
      scenario: "Invalid Mandatory Field {} ... etc",
      expectedResult: `Error Code: 400xx02\nError Message: "Invalid Mandatory Field {......}"`,
      step: "Hapus field mandatory (merchantId) dari body request",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Removed merchantId from body. responseCode=${responseCode}, responseMessage=${responseMessage}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #3b: Invalid Mandatory Field - Missing CHANNEL-ID header
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #3b: Invalid Mandatory Field - Missing CHANNEL-ID ━━━");
  {
    const externalId = generateExternalId();
    const body = buildGenerateBody();

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: GENERATE_PATH,
      body,
      accessToken: validToken,
      externalId,
      overrideHeaders: {
        "CHANNEL-ID": "", // empty CHANNEL-ID
      },
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode.includes("400") && responseCode.includes("02");

    results.push({
      no: "3b",
      service: "Any Service (QR MPM Generate)",
      scenario: "Invalid Mandatory Field - CHANNEL-ID tidak dikirim/kosong",
      expectedResult: `Error Code: 400xx02\nError Message: "Invalid Mandatory Field {CHANNEL-ID}"`,
      step: "Kirim CHANNEL-ID header kosong",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Empty CHANNEL-ID header. responseCode=${responseCode}, responseMessage=${responseMessage}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #4: Invalid Field Format (Any Service)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #4: Invalid Field Format ━━━");
  {
    const externalId = generateExternalId();
    // Send amount with wrong format (e.g. "10000.0" instead of "10000.00")
    const body = buildGenerateBody({
      amount: { value: "10000.0", currency: "IDR" },
    });

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: GENERATE_PATH,
      body,
      accessToken: validToken,
      externalId,
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode.includes("400") && responseCode.includes("01");

    results.push({
      no: 4,
      service: "Any Service (QR MPM Generate)",
      scenario: "Invalid Field Format {} ... etc",
      expectedResult: `Error Code: 400xx01\nError Message: "Invalid Field Format {......}"`,
      step: 'Ubah format amount.value menjadi "10000.0" (format desimal salah)',
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Sent amount.value="10000.0" instead of "10000.00". responseCode=${responseCode}, responseMessage=${responseMessage}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #5: Cannot use same X-EXTERNAL-ID (Conflict) (Any Service)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #5: Cannot use same X-EXTERNAL-ID (Conflict) ━━━");
  {
    // First, send a valid request
    const duplicateExternalId = generateExternalId();
    const body1 = buildGenerateBody();

    console.log("  Sending first request with externalId:", duplicateExternalId);
    const first = await callApi({
      path: GENERATE_PATH,
      body: body1,
      accessToken: validToken,
      externalId: duplicateExternalId,
    });
    console.log(`  First request: HTTP ${first.httpStatus} | responseCode: ${first.responseObj?.responseCode}`);

    // Small delay to ensure server processes it
    await new Promise((r) => setTimeout(r, 1500));

    // Second, send another request with the SAME externalId
    console.log("  Sending DUPLICATE request with same externalId:", duplicateExternalId);
    const body2 = buildGenerateBody();
    const { requestObj, responseObj, httpStatus } = await callApi({
      path: GENERATE_PATH,
      body: body2,
      accessToken: validToken,
      externalId: duplicateExternalId,
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode.includes("409") && responseCode.includes("00");

    results.push({
      no: 5,
      service: "Any Service (QR MPM Generate)",
      scenario: "Cannot use the same X-EXTERNAL-ID",
      expectedResult: `Error Code: 409xx00\nError Message: "Conflict"`,
      step: `Kirim X-EXTERNAL-ID yang sama (${duplicateExternalId}) dengan request sebelumnya`,
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Duplicate X-EXTERNAL-ID=${duplicateExternalId}. First call code=${first.responseObj?.responseCode}. responseCode=${responseCode}, responseMessage=${responseMessage}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #6: QR MPM Generate - Show QR Code (Happy Path)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #6: QR MPM Generate - Show QR Code (Happy Path) ━━━");
  let generatedReferenceNo = "";
  let generatedPartnerRefNo = "";
  let generatedExternalIdForQuery = "";
  {
    const externalId = generateExternalId();
    generatedExternalIdForQuery = externalId;
    const body = buildGenerateBody();

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: GENERATE_PATH,
      body,
      accessToken: validToken,
      externalId,
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode === "2004700" && responseMessage.toLowerCase().includes("success");

    // Capture referenceNo for Query Payment tests
    if (responseObj?.referenceNo) {
      generatedReferenceNo = responseObj.referenceNo;
    }
    if (responseObj?.partnerReferenceNo) {
      generatedPartnerRefNo = responseObj.partnerReferenceNo;
    }

    results.push({
      no: 6,
      service: "QR MPM - Generate QR",
      scenario: "Show QR Code",
      expectedResult: `Response Code: 2004700\nResponse Message: "Successful"`,
      step: "Kirim request QR Generate dengan data valid",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `QR generated. responseCode=${responseCode}, responseMessage=${responseMessage}. qrContent=${responseObj?.qrContent ? "YES" : "NO"}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #7: QR MPM Generate - Invalid Merchant
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #7: QR MPM Generate - Invalid Merchant ━━━");
  {
    const externalId = generateExternalId();
    // Use a clearly invalid merchant ID
    const body = buildGenerateBody({
      merchantId: "000000000000000", // invalid/non-existent merchant
    });

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: GENERATE_PATH,
      body,
      accessToken: validToken,
      externalId,
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode === "4044708";

    results.push({
      no: 7,
      service: "QR MPM - Generate QR",
      scenario: "Invalid Merchant",
      expectedResult: `Error Code: 4044708\nError Message: "Invalid Merchant"`,
      step: 'Kirim merchantId yang tidak valid ("000000000000000")',
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Scenario Invalid Merchant MID. responseCode=${responseCode}, responseMessage=${responseMessage}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #8-12: Repeat Any Service tests on QR MPM Query endpoint
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #8: QR MPM Query - Access Token Invalid ━━━");
  {
    const externalId = generateExternalId();
    const body = buildQueryBody();
    const invalidToken = "INVALID_ACCESS_TOKEN_FOR_TESTING";

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: QUERY_PATH,
      body,
      accessToken: invalidToken,
      externalId,
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode.startsWith("401") && responseCode.includes("01");

    results.push({
      no: 8,
      service: "QR MPM - Query (Access Token Invalid)",
      scenario: "Access Token Invalid",
      expectedResult: `Error Code: 401xx01\nError Message: "Access Token Invalid"`,
      step: "Kirim query request dengan Bearer token tidak valid",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Query endpoint, invalid token. responseCode=${responseCode}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  console.log("━━━ TC #9: QR MPM Query - Unauthorized Signature ━━━");
  {
    const externalId = generateExternalId();
    const body = buildQueryBody();

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: QUERY_PATH,
      body,
      accessToken: validToken,
      externalId,
      invalidSignature: true,
    });

    const responseCode = responseObj?.responseCode || "";
    const pass = responseCode.startsWith("401") && responseCode.includes("00");

    results.push({
      no: 9,
      service: "QR MPM - Query (Unauthorized Signature)",
      scenario: "Unauthorized . Signature",
      expectedResult: `Error Code: 401xx00\nError Message: "Unauthorized Signature"`,
      step: "Kirim query request dengan X-SIGNATURE yang salah",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Query endpoint, invalid signature. responseCode=${responseCode}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #10-14: Repeat Any Service tests on QR MPM Cancel endpoint
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #10: QR MPM Cancel - Access Token Invalid ━━━");
  {
    const externalId = generateExternalId();
    const body = buildCancelBody();
    const invalidToken = "INVALID_ACCESS_TOKEN_FOR_TESTING";

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: CANCEL_PATH,
      body,
      accessToken: invalidToken,
      externalId,
    });

    const responseCode = responseObj?.responseCode || "";
    const pass = responseCode.startsWith("401") && responseCode.includes("01");

    results.push({
      no: 10,
      service: "QR MPM - Cancel (Access Token Invalid)",
      scenario: "Access Token Invalid",
      expectedResult: `Error Code: 401xx01\nError Message: "Access Token Invalid"`,
      step: "Kirim cancel request dengan Bearer token tidak valid",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Cancel endpoint, invalid token. responseCode=${responseCode}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  console.log("━━━ TC #11: QR MPM Cancel - Unauthorized Signature ━━━");
  {
    const externalId = generateExternalId();
    const body = buildCancelBody();

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: CANCEL_PATH,
      body,
      accessToken: validToken,
      externalId,
      invalidSignature: true,
    });

    const responseCode = responseObj?.responseCode || "";
    const pass = responseCode.startsWith("401") && responseCode.includes("00");

    results.push({
      no: 11,
      service: "QR MPM - Cancel (Unauthorized Signature)",
      scenario: "Unauthorized . Signature",
      expectedResult: `Error Code: 401xx00\nError Message: "Unauthorized Signature"`,
      step: "Kirim cancel request dengan X-SIGNATURE yang salah",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Cancel endpoint, invalid signature. responseCode=${responseCode}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #12: Query Payment - Pending Transaction/Inquiry (Happy Path)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #12: Query Payment - Pending Transaction/Inquiry ━━━");
  {
    const externalId = generateExternalId();
    // Use the referenceNo from TC #6 (successful QR Generate) to query its status
    const body = buildQueryBody({
      originalReferenceNo: generatedReferenceNo || "REF_FROM_TC6",
      originalExternalId: generatedExternalIdForQuery || generateExternalId(),
    });

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: QUERY_PATH,
      body,
      accessToken: validToken,
      externalId,
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode === "2005100" && responseMessage.toLowerCase().includes("success");

    results.push({
      no: 12,
      service: "Query Payment",
      scenario: "Pending Transaction/Inquiry",
      expectedResult: `Response Code: 2005100\nResponse Message: "Successful"`,
      step: "Kirim query payment dengan referenceNo dari transaksi QR yang sudah di-generate (TC #6)",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Query payment inquiry. originalReferenceNo=${generatedReferenceNo}. responseCode=${responseCode}, responseMessage=${responseMessage}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #13: Query Payment - Transaction Not Found
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #13: Query Payment - Transaction Not Found ━━━");
  {
    const externalId = generateExternalId();
    // Use a non-existent referenceNo to trigger Transaction Not Found
    const body = buildQueryBody({
      originalReferenceNo: "NONEXISTENT_REF_999999",
      originalExternalId: generateExternalId(),
    });

    const { requestObj, responseObj, httpStatus } = await callApi({
      path: QUERY_PATH,
      body,
      accessToken: validToken,
      externalId,
    });

    const responseCode = responseObj?.responseCode || "";
    const responseMessage = responseObj?.responseMessage || "";
    const pass = responseCode === "4045103";

    results.push({
      no: 13,
      service: "Query Payment",
      scenario: "Transaction Not Found",
      expectedResult: `Response Code: 4045103\nResponse Message: "Transaction Not Found"`,
      step: "Kirim query payment dengan referenceNo yang tidak ada",
      request: requestObj,
      response: responseObj,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Query payment with non-existent ref. responseCode=${responseCode}, responseMessage=${responseMessage}`,
    });
    console.log(`  HTTP ${httpStatus} | responseCode: ${responseCode} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TC #14: Access Token - Happy Path
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("━━━ TC #14: Access Token B2B - Happy Path ━━━");
  {
    const timestamp = getTimestamp();
    const signature = buildTokenSignature(CLIENT_KEY, timestamp);

    const reqHeaders = {
      "Content-Type": "application/json",
      "X-CLIENT-KEY": CLIENT_KEY,
      "X-TIMESTAMP": timestamp,
      "X-SIGNATURE": signature,
      "X-PLATFORM": "PORTAL",
    };
    const reqBody = { grantType: "client_credentials" };

    let responseObj, httpStatus;
    try {
      const res = await fetch(`${BASE_URL}${TOKEN_PATH}`, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(reqBody),
      });
      httpStatus = res.status;
      responseObj = await res.json().catch(() => ({}));
    } catch (err) {
      httpStatus = 0;
      responseObj = { error: err.message };
    }

    const pass = !!responseObj?.accessToken;
    // Mask the access token in response for security
    const maskedResponse = { ...responseObj };
    if (maskedResponse.accessToken) {
      maskedResponse.accessToken = maskedResponse.accessToken.substring(0, 20) + "...[MASKED]";
    }

    results.push({
      no: 14,
      service: "Access Token B2B",
      scenario: "Get Access Token (Happy Path)",
      expectedResult: `HTTP 200\naccessToken present in response`,
      step: "Kirim request access token dengan credentials valid",
      request: { method: "POST", url: `${BASE_URL}${TOKEN_PATH}`, headers: reqHeaders, body: reqBody },
      response: maskedResponse,
      httpStatus,
      result: pass ? "PASS" : "FAIL",
      notes: `Access token ${pass ? "received successfully" : "NOT received"}`,
    });
    console.log(`  HTTP ${httpStatus} | accessToken: ${pass ? "YES" : "NO"} | ${pass ? "✅ PASS" : "❌ FAIL"}\n`);
  }

  return results;
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function escapeCSV(val) {
  if (val === null || val === undefined) return "";
  const str = typeof val === "string" ? val : JSON.stringify(val, null, 2);
  // Escape quotes and wrap in quotes if contains comma, newline, or quote
  if (str.includes(",") || str.includes("\n") || str.includes('"') || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCSV(results) {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `yokke-test-results-${dateStr}.csv`;
  const filepath = resolve(__dirname, filename);

  const headers = [
    "No",
    "Service",
    "Scenario",
    "Expected Result",
    "Request (Headers)",
    "Request (Body)",
    "HTTP Status",
    "Response",
    "Result",
    "Notes",
    "Step",
  ];

  const rows = results.map((r) => {
    // Separate request headers and body for readability
    const reqHeaders = r.request?.headers ? JSON.stringify(r.request.headers, null, 2) : "";
    const reqBody = r.request?.body ? JSON.stringify(r.request.body, null, 2) : "";
    const response = r.response ? JSON.stringify(r.response, null, 2) : "";

    return [
      r.no,
      r.service,
      r.scenario,
      r.expectedResult,
      reqHeaders,
      reqBody,
      r.httpStatus,
      response,
      r.result,
      r.notes,
      r.step,
    ].map(escapeCSV).join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  writeFileSync(filepath, "\uFEFF" + csv, "utf-8"); // BOM for Excel compatibility
  return { filepath, filename };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const results = await runAllTests();

    // Print summary
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("  TEST SUMMARY");
    console.log("═══════════════════════════════════════════════════════════════");

    const passed = results.filter((r) => r.result === "PASS").length;
    const failed = results.filter((r) => r.result === "FAIL").length;

    for (const r of results) {
      const icon = r.result === "PASS" ? "✅" : "❌";
      console.log(`  ${icon} TC #${String(r.no).padEnd(3)} | ${r.scenario.padEnd(45)} | ${r.result}`);
    }

    console.log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

    // Write CSV
    const { filepath, filename } = writeCSV(results);
    console.log(`\n📄 Results saved to: ${filename}`);
    console.log(`   Full path: ${filepath}`);
    console.log("═══════════════════════════════════════════════════════════════\n");
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
