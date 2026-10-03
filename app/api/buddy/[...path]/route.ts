import { env } from "cloudflare:workers";
import { handleBuddy, type BuddyEnv } from "../../../../lib/buddy/server.ts";

export function GET(request: Request): Promise<Response> { return handleBuddy(request, env as unknown as BuddyEnv); }
export function POST(request: Request): Promise<Response> { return handleBuddy(request, env as unknown as BuddyEnv); }
export function DELETE(request: Request): Promise<Response> { return handleBuddy(request, env as unknown as BuddyEnv); }
