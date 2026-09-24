import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST as submitRoute } from "@/app/api/research/tasks/route"
import { GET as statusRoute } from "@/app/api/research/tasks/[taskId]/route"
import { POST as cancelRoute } from "@/app/api/research/tasks/[taskId]/cancel/route"
import { cancelConfiguredQuantAgentTask, readConfiguredQuantAgentTask, submitConfiguredQuantAgentTask } from "@/lib/quantagent/task-server"
import { QuantAgentTaskError } from "@/lib/quantagent/task-api"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/quantagent/task-server", () => ({
  submitConfiguredQuantAgentTask: vi.fn(),
  readConfiguredQuantAgentTask: vi.fn(),
  cancelConfiguredQuantAgentTask: vi.fn(),
}))

const taskId = `task-${"a".repeat(32)}`
const task = {
  contract_type: "quantagent.run_status.v2" as const,
  run_id: taskId,
  status: "queued" as const,
  cancel_requested: false,
  created_at: "2026-09-23T00:00:00Z",
  started_at: null,
  completed_at: null,
  failure_type: null,
  links: { summary: null, report: null },
}
const submitMock = vi.mocked(submitConfiguredQuantAgentTask)
const readMock = vi.mocked(readConfiguredQuantAgentTask)
const cancelMock = vi.mocked(cancelConfiguredQuantAgentTask)

function post(url: string, origin = "https://openstock.example.test", body?: string) {
  return new Request(url, { method: "POST", headers: { Origin: origin }, ...(body ? { body } : {}) })
}

describe("OpenStock controlled task routes", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "https://openstock.example.test")
    submitMock.mockResolvedValue(task)
    readMock.mockResolvedValue(task)
    cancelMock.mockResolvedValue(task)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  it("rejects cross-origin submissions before task admission", async () => {
    expect((await submitRoute(post("https://openstock.example.test/api/research/tasks", "https://evil.example.test"))).status).toBe(403)
    expect(submitMock).not.toHaveBeenCalled()
  })

  it("ignores client-selected fixture fields and invokes only the fixed server submission", async () => {
    const response = await submitRoute(post("https://openstock.example.test/api/research/tasks", "https://openstock.example.test", "{\"fixture_id\":\"other\"}"))
    expect(response.status).toBe(200)
    expect(submitMock).toHaveBeenCalledExactlyOnceWith()
  })

  it("returns only task status with private no-store headers", async () => {
    const response = await submitRoute(post("https://openstock.example.test/api/research/tasks"))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual(task)
    expect(submitMock).toHaveBeenCalledOnce()
  })

  it("status refresh is GET-only and cannot admit a new task", async () => {
    const response = await statusRoute(new Request(`https://openstock.example.test/api/research/tasks/${taskId}`), { params: Promise.resolve({ taskId }) })
    expect(response.status).toBe(200)
    expect(readMock).toHaveBeenCalledExactlyOnceWith(taskId)
    expect(submitMock).not.toHaveBeenCalled()
  })

  it("requires same-origin cancellation and maps account denial", async () => {
    const context = { params: Promise.resolve({ taskId }) }
    expect((await cancelRoute(post(`https://openstock.example.test/api/research/tasks/${taskId}/cancel`, "https://evil.example.test"), context)).status).toBe(403)
    expect(cancelMock).not.toHaveBeenCalled()
    cancelMock.mockRejectedValue(new QuantAgentTaskError("access_denied"))
    const response = await cancelRoute(post(`https://openstock.example.test/api/research/tasks/${taskId}/cancel`), context)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { code: "access_denied" } })
  })
})
