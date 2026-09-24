import "server-only"

import { NextResponse } from "next/server"

import { QuantAgentTaskError, type QuantAgentTaskErrorCode, type QuantAgentTaskStatus } from "@/lib/quantagent/task-api"

const NO_STORE = { "Cache-Control": "private, no-store" }

const HTTP_STATUS: Record<QuantAgentTaskErrorCode, number> = {
  configuration_error: 503,
  invalid_task_id: 400,
  invalid_submission: 400,
  authentication_required: 502,
  access_denied: 403,
  task_not_found: 404,
  idempotency_conflict: 409,
  task_capacity_reached: 429,
  task_not_cancelable: 409,
  task_interrupted: 409,
  upstream_unavailable: 502,
  invalid_response: 502,
}

export function taskJson(status: QuantAgentTaskStatus) {
  return NextResponse.json(status, { headers: NO_STORE })
}

export function taskError(error: unknown) {
  const code = error instanceof QuantAgentTaskError ? error.code : "upstream_unavailable"
  return NextResponse.json({ error: { code } }, { status: HTTP_STATUS[code], headers: NO_STORE })
}

export function isSameOriginWrite(request: Request): boolean {
  const origin = request.headers.get("origin")
  const configured = process.env.BETTER_AUTH_URL
  if (!origin || !configured) return false
  try {
    return origin === new URL(configured).origin
  } catch {
    return false
  }
}
