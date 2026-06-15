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

    // Yokke QRIS MPM
    yokkeIsProduction: process.env.YOKKE_IS_PRODUCTION === "1",
    yokkeClientKey: process.env.YOKKE_CLIENT_KEY,       // X-CLIENT-KEY (username)
    yokkePrivateKey: process.env.YOKKE_PRIVATE_KEY,     // RSA private key (PEM) for access token signature
    yokkeClientSecret: process.env.YOKKE_CLIENT_SECRET, // HMAC-SHA512 secret for API call signatures
    yokkePartnerId: process.env.YOKKE_PARTNER_ID,       // X-PARTNER-ID
    yokkeChannelId: process.env.YOKKE_CHANNEL_ID,       // CHANNEL-ID (e.g. "02")
    yokkeMerchantId: (process.env.YOKKE_MERCHANT_ID ?? "").padStart(15, "0"), // merchantId padded to 15 chars
    yokkeTerminalId: process.env.YOKKE_TERMINAL_ID,     // terminalId in request body

}