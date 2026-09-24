import { describe, expect, it, vi } from "vitest"

import {
  cancelQuantAgentTask,
  getQuantAgentTaskStatus,
  parseQuantAgentTaskStatus,
  submitQuantAgentTask,
  type QuantAgentTaskStatus,
} from "@/lib/quantagent/task-api"

const taskId = `task-${"a".repeat(32)}`
const token = "test-only-token-with-at-least-32-characters"
const config = { baseUrl: "http://127.0.0.1:8765", bearerToken: token }
const submission = {
  fixtureId: "thesis",
  fixtureSha256: "b".repeat(64),
  requestId: "request.btc.thesis.20260922",
  idempotencyKey: "c".repeat(64),
}
const queued: QuantAgentTaskStatus = {
  contract_type: "quantagent.run_status.v2",
  run_id: taskId,
  status: "queued",
  cancel_requested: false,
  created_at: "2026-09-23T00:00:00Z",
  started_at: null,
  completed_at: null,
  failure_type: null,
  links: { summary: null, report: null },
}

function jsonResponse(body: unknown, status = 200, location?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(location ? { location } : {}) },
  })
}

describe("QuantAgent controlled task adapter", () => {
  it("submits only the fixed contract with a stable key and no browser credential", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(queued, 202, `/api/v2/runs/${taskId}`))

    await submitQuantAgentTask(config, submission, fetchMock)
    await submitQuantAgentTask(config, submission, fetchMock)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url.toString()).toBe("http://127.0.0.1:8765/api/v2/runs")
      expect(init?.method).toBe("POST")
      expect(init?.cache).toBe("no-store")
      expect(init?.redirect).toBe("error")
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`)
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(submission.idempotencyKey)
      expect(JSON.parse(String(init?.body))).toEqual({
        contract_type: "quantagent.submit_run.v1",
        fixture_id: submission.fixtureId,
        fixture_sha256: submission.fixtureSha256,
        request_id: submission.requestId,
      })
    }
    expect(JSON.stringify(queued)).not.toContain(token)
  })

  it("reads status without submitting and cancels only the validated task ID", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(queued))

    expect(await getQuantAgentTaskStatus(config, taskId, fetchMock)).toEqual(queued)
    expect(await cancelQuantAgentTask(config, taskId, fetchMock)).toEqual(queued)
    expect(fetchMock.mock.calls.map(([url, init]) => [url.toString(), init?.method])).toEqual([
      [`http://127.0.0.1:8765/api/v2/runs/${taskId}`, "GET"],
      [`http://127.0.0.1:8765/api/v2/runs/${taskId}/cancel`, "POST"],
    ])
    await expect(cancelQuantAgentTask(config, "../secret", fetchMock)).rejects.toMatchObject({ code: "invalid_task_id" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects untrusted redirects, foreign run IDs, and forged result links", async () => {
    await expect(submitQuantAgentTask(config, submission, vi.fn(async () => jsonResponse(queued, 202, "https://example.test/steal")))).rejects.toMatchObject({ code: "invalid_response" })
    await expect(getQuantAgentTaskStatus(config, taskId, vi.fn(async () => jsonResponse({ ...queued, run_id: `task-${"d".repeat(32)}` })))).rejects.toMatchObject({ code: "invalid_response" })
    await expect(getQuantAgentTaskStatus(config, taskId, vi.fn(async () => jsonResponse({ ...queued, links: { summary: "/api/v1/runs/other", report: null } })))).rejects.toMatchObject({ code: "invalid_response" })
  })

  it("maps bounded public upstream errors without exposing their message", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ error: { code: "task_capacity_reached", message: "C:/secret" } }, 429))
    await expect(submitQuantAgentTask(config, submission, fetchMock)).rejects.toMatchObject({ code: "task_capacity_reached", status: 429 })
    const cancelMock = vi.fn<typeof fetch>(async () => jsonResponse({ error: { code: "task_not_cancelable" } }, 409))
    await expect(cancelQuantAgentTask(config, taskId, cancelMock)).rejects.toMatchObject({ code: "task_not_cancelable", status: 409 })
  })

  it("rejects invalid task responses and unsafe configuration before any fetch", async () => {
    expect(() => parseQuantAgentTaskStatus({ ...queued, status: "trading" })).toThrowError()
    expect(() => parseQuantAgentTaskStatus({ ...queued, run_id: "../secret" })).toThrowError()
    const fetchMock = vi.fn<typeof fetch>()
    await expect(submitQuantAgentTask({ ...config, baseUrl: "http://example.test" }, submission, fetchMock)).rejects.toMatchObject({ code: "configuration_error" })
    await expect(submitQuantAgentTask(config, { ...submission, fixtureId: "../secret" }, fetchMock)).rejects.toMatchObject({ code: "configuration_error" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
