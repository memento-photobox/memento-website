export const env = {
    emailUser: process.env.EMAIL_USER,
    gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    bucketBaseUrl: process.env.BUCKET_BASE_URL,
    midtransMerchantId: process.env.MIDTRANS_MERCHANT_ID,
    midtransClientKey: process.env.MIDTRANS_CLIENT_KEY,
    midtransServerKey: process.env.MIDTRANS_SERVER_KEY,
    midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION === "1",
    midtransPrice: process.env.MIDTRANS_PRICE,
    cronSecret: process.env.CRON_SECRET,

    basicAuthSecret: process.env.BASIC_AUTH_SECRET,

    duitkuIsProduction: process.env.DUITKU_IS_PRODUCTION === "1",
    duitkuMerchantId: process.env.DUITKU_MERCHANT_ID,
    duitkuAPIKey: process.env.DUITKU_API_KEY,
    duitkuPrice: process.env.DUITKU_PRICE,

    duitkuToken: process.env.DUITKU_TOKEN,
    duitkuChannelId: process.env.DUITKU_CHANNEL_ID,
    duitkuClientKey: process.env.DUITKU_CLIENT_KEY,
    duitkuPrivateKey: process.env.DUITKU_PRIVATE_KEY,
    duitkuBearer: process.env.DUITKU_BEARER,

    // Yokke QRIS MPM (Sandbox / Default)
    yokkeIsProduction: process.env.YOKKE_IS_PRODUCTION === "1",
    yokkeClientKey: process.env.YOKKE_CLIENT_KEY,       // X-CLIENT-KEY (username)
    yokkePrivateKey: process.env.YOKKE_PRIVATE_KEY,     // RSA private key (PEM) for access token signature
    yokkeClientSecret: process.env.YOKKE_CLIENT_SECRET, // HMAC-SHA512 secret for API call signatures
    yokkePartnerId: process.env.YOKKE_PARTNER_ID,       // X-PARTNER-ID
    yokkeChannelId: process.env.YOKKE_CHANNEL_ID,       // CHANNEL-ID (e.g. "02")
    yokkeMerchantId: (process.env.YOKKE_MERCHANT_ID ?? "").padStart(15, "0"), // merchantId padded to 15 chars
    yokkeTerminalId: process.env.YOKKE_TERMINAL_ID,     // terminalId in request body

    // Yokke QRIS MPM (Production / PTR)
    yokkeProdClientKey: process.env.YOKKE_PROD_CLIENT_KEY ?? "ab60a20c-19fd-4681-9476-b682fa434da4",
    yokkeProdClientSecret: process.env.YOKKE_PROD_CLIENT_SECRET ?? "af31821d-eb0a-458b-8a06-4df3f7e4f4fb",
    yokkeProdPublicKey:
        process.env.YOKKE_PROD_PUBLIC_KEY ??
        "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx3RwTbribU3+5aJ4d8qO\n4cvqOpx3U03y4bbZeOLTG46ykZFfXm+2FqXqD5Ii1X8eBafTGS4DmmsUiyYJFIjm\n6OyikBv6zFqdprKriD3/6mgOwrkFJWvAucXje+VGx/3Q/DvrCaizaimPdurn3nW9\niU0GhUO+rFlVxa32bPc1iHZMEnq0fINaxsulB8N+hgmVFRNGAuN6F6lTD5bmmnj+\nxb4W7otlwOHL8SYN3iZvJD9KZrjptLscuTdZkj76ggupgmVx2kPMk6uwYxT1bypA\nS2gfha6hg+OpRxJ/tLHCyh2TV0DGgztappiH9f2OMi5nkIfGpDc6HJj9ZajfFEtb\nDwIDAQAB\n-----END PUBLIC KEY-----",
    yokkeProdPrivateKey: process.env.YOKKE_PROD_PRIVATE_KEY || "",
    yokkeProdPartnerId: process.env.YOKKE_PROD_PARTNER_ID ?? "MEMENTOMPMSNAP",
    yokkeProdChannelId: process.env.YOKKE_PROD_CHANNEL_ID ?? "02",
    yokkeProdMerchantId: (process.env.YOKKE_PROD_MERCHANT_ID ?? "71028859200").padStart(15, "0"),
    yokkeProdTerminalId: process.env.YOKKE_PROD_TERMINAL_ID ?? "86847056",
    yokkeProdMerchantName: process.env.YOKKE_PROD_MERCHANT_NAME ?? "PTR API QRIS 3 DJAKARTA",
}