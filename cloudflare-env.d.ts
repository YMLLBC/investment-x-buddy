declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DEEPSEEK_API_KEY?: string;
    DEEPSEEK_BASE_URL?: string;
    DEEPSEEK_MODEL?: string;
    DEEPSEEK_REASONING_EFFORT?: string;
    FUYAO_API_KEY?: string;
    IFIND_API_KEY?: string;
    IFIND_MCP_BASE_URL?: string;
    RESEARCH_ACCESS_CODE?: string;
    SESSION_SECRET?: string;
    MODEL_INPUT_USD_PER_MILLION?: string;
    MODEL_CACHED_INPUT_USD_PER_MILLION?: string;
    MODEL_OUTPUT_USD_PER_MILLION?: string;
    RUN_BUDGET_USD?: string;
    DAILY_MODEL_BUDGET_USD?: string;
  }
}
