declare global {
  interface CloudflareEnv {
    DB: D1Database;
    STORAGE: R2Bucket;
    KV: KVNamespace;
    GEMINI_API_KEY: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_PRO_PRICE_ID: string;
    NEXT_PUBLIC_APP_URL: string;
  }
}
export {};
