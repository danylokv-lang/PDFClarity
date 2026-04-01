declare global {
  interface CloudflareEnv {
    DB: D1Database;
    STORAGE: R2Bucket;
    KV: KVNamespace;
    GEMINI_API_KEY: string;
  }
}
export {};
