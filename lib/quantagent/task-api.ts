import { normalizeQuantAgentBaseUrl, QuantAgentReadError } from "@/lib/quantagent/read-api"

const TASK_ID = /^task-[a-f0-9]{32}$/
const FIXTURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SHA256 = /^[a-f0-9]{64}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/
const MAX_RESPONSE_BYTES = 64 * 1024

export type QuantAgentTaskState = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
export type QuantAgentTaskErrorCode =
  | "configuration_error"
  | "invalid_task_id"
  | "invalid_submission"
  | "authentication_required"
  | "access_denied"
  | "task_not_found"
  | "idempotency_conflict"
  | "task_capacity_reached"
  | "task_not_cancelable"
  | "task_interrupted"
  | "upstream_unavailable"
  | "invalid_response"

export class QuantAgentTaskError extends Error {
  constructor(public readonly code: QuantAgentTaskErrorCode, public readonly status?: number) {
    super(code)
    this.name = "QuantAgentTaskError"
  }
}

export interface QuantAgentTaskStatus {
  contract_type: "quantagent.run_status.v2"
  run_id: string
  status: QuantAgentTaskState
  cancel_requested: boolean
  created_at: string
  started_at: string | null
  completed_at: string | null
  failure_type: string | null
  links: { summary: string | null; report: string | null }
}

export interface QuantAgentTaskConfig {
  baseUrl: string
  bearerToken: string
}

export interface QuantAgentFixedSubmission {
  fixtureId: string
  fixtureSha256: string
  requestId: string
  idempotencyKey: string
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QuantAgentTaskError("invalid_response")
  return value as Record<string, unknown>
}

function dateTime(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new QuantAgentTaskError("invalid_response")
  return value
}

function nullableDateTime(value: unknown): string | null {
  return value === null ? null : dateTime(value)
}

export function parseQuantAgentTaskStatus(value: unknown): QuantAgentTaskStatus {
  const payload = record(value)
  if (payload.contract_type !== "quantagent.run_status.v2" || typeof payload.run_id !== "string" || !TASK_ID.test(payload.run_id)) {
    throw new QuantAgentTaskError("invalid_response")
  }
  const state = payload.status
  if (state !== "queued" && state !== "running" && state !== "completed" && state !== "failed" && state !== "cancelled" && state !== "interrupted") {
    throw new QuantAgentTaskError("invalid_response")
  }
  if (typeof payload.cancel_requested !== "boolean") throw new QuantAgentTaskError("invalid_response")
  const links = record(payload.links)
  const expectedSummary = `/api/v1/runs/${payload.run_id}`
  const expectedReport = `${expectedSummary}/report`
  if (state === "completed") {
    if (links.summary !== expectedSummary || links.report !== expectedReport) throw new QuantAgentTaskError("invalid_response")
  } else if (links.summary !== null || links.report !== null) {
    throw new QuantAgentTaskError("invalid_response")
  }
  if (payload.failure_type !== null && (typeof payload.failure_type !== "string" || payload.failure_type.length > 128)) {
    throw new QuantAgentTaskError("invalid_response")
  }
  return {
    contract_type: "quantagent.run_status.v2",
    run_id: payload.run_id,
    status: state,
    cancel_requested: payload.cancel_requested,
    created_at: dateTime(payload.created_at),
    started_at: nullableDateTime(payload.started_at),
    completed_at: nullableDateTime(payload.completed_at),
    failure_type: payload.failure_type,
    links: { summary: links.summary as string | null, report: links.report as string | null },
  }
}

function endpoint(config: QuantAgentTaskConfig, path: string): URL {
  if (!config.bearerToken || config.bearerToken.length < 32 || !config.bearerToken.trim()) {
    throw new QuantAgentTaskError("configuration_error")
  }
  try {
    return new URL(path, normalizeQuantAgentBaseUrl(config.baseUrl))
  } catch (error) {
    if (error instanceof QuantAgentReadError) throw new QuantAgentTaskError("configuration_error")
    throw error
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new QuantAgentTaskError("invalid_response")
  }
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new QuantAgentTaskError("invalid_response")
  if (!response.body) throw new QuantAgentTaskError("invalid_response")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_RESPONSE_BYTES) throw new QuantAgentTaskError("invalid_response")
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new QuantAgentTaskError("invalid_response")
  }
}

async function upstreamError(response: Response): Promise<QuantAgentTaskError> {
  try {
    const body = record(await boundedJson(response))
    const code = record(body.error).code
    if (code === "invalid_submission" || code === "authentication_required" || code === "access_denied" || code === "task_not_found" || code === "idempotency_conflict" || code === "task_capacity_reached" || code === "task_not_cancelable" || code === "task_interrupted") {
      return new QuantAgentTaskError(code, response.status)
    }
  } catch {
    // Keep the public error surface independent from upstream details.
  }
  return new QuantAgentTaskError("upstream_unavailable", response.status)
}

async function taskRequest(
  config: QuantAgentTaskConfig,
  path: string,
  method: "GET" | "POST",
  expectedStatuses: readonly number[],
  options: { body?: string; idempotencyKey?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: QuantAgentTaskStatus; location: string | null }> {
  const url = endpoint(config, path)
  let response: Response
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      ...(options.body ? { body: options.body } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    throw new QuantAgentTaskError("upstream_unavailable")
  }
  if (!expectedStatuses.includes(response.status)) throw await upstreamError(response)
  return { status: parseQuantAgentTaskStatus(await boundedJson(response)), location: response.headers.get("location") }
}

export async function submitQuantAgentTask(
  config: QuantAgentTaskConfig,
  submission: QuantAgentFixedSubmission,
  fetchImpl: typeof fetch = fetch,
): Promise<QuantAgentTaskStatus> {
  if (!FIXTURE_ID.test(submission.fixtureId) || !SHA256.test(submission.fixtureSha256) || !FIXTURE_ID.test(submission.requestId) || !IDEMPOTENCY_KEY.test(submission.idempotencyKey)) {
    throw new QuantAgentTaskError("configuration_error")
  }
  const body = JSON.stringify({
    contract_type: "quantagent.submit_run.v1",
    fixture_id: submission.fixtureId,
    fixture_sha256: submission.fixtureSha256,
    request_id: submission.requestId,
  })
  const result = await taskRequest(config, "api/v2/runs", "POST", [200, 202], { body, idempotencyKey: submission.idempotencyKey }, fetchImpl)
  if (result.location !== `/api/v2/runs/${result.status.run_id}`) throw new QuantAgentTaskError("invalid_response")
  return result.status
}

export async function getQuantAgentTaskStatus(config: QuantAgentTaskConfig, taskId: string, fetchImpl: typeof fetch = fetch): Promise<QuantAgentTaskStatus> {
  if (!TASK_ID.test(taskId)) throw new QuantAgentTaskError("invalid_task_id")
  const result = await taskRequest(config, `api/v2/runs/${taskId}`, "GET", [200], {}, fetchImpl)
  if (result.status.run_id !== taskId) throw new QuantAgentTaskError("invalid_response")
  return result.status
}

export async function cancelQuantAgentTask(config: QuantAgentTaskConfig, taskId: string, fetchImpl: typeof fetch = fetch): Promise<QuantAgentTaskStatus> {
  if (!TASK_ID.test(taskId)) throw new QuantAgentTaskError("invalid_task_id")
  const result = await taskRequest(config, `api/v2/runs/${taskId}/cancel`, "POST", [200, 202], {}, fetchImpl)
  if (result.status.run_id !== taskId) throw new QuantAgentTaskError("invalid_response")
  return result.status
}
