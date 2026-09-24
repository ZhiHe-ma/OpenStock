import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { canAccessQuantAgentResearch } from "@/lib/quantagent/server"
import { submitQuantAgentTask } from "@/lib/quantagent/task-api"
import { isConfiguredQuantAgentTaskPilot, submitConfiguredQuantAgentTask } from "@/lib/quantagent/task-server"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/quantagent/server", () => ({ canAccessQuantAgentResearch: vi.fn() }))
vi.mock("@/lib/quantagent/task-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/quantagent/task-api")>()),
  submitQuantAgentTask: vi.fn(),
}))

const accessMock = vi.mocked(canAccessQuantAgentResearch)
const submitMock = vi.mocked(submitQuantAgentTask)

describe("configured task pilot", () => {
  beforeEach(() => {
    vi.stubEnv("QUANTAGENT_ALLOWED_USER_ID", "owner-user-id")
    vi.stubEnv("QUANTAGENT_SUBMIT_FIXTURE_ID", "thesis")
    vi.stubEnv("QUANTAGENT_SUBMIT_FIXTURE_SHA256", "a".repeat(64))
    vi.stubEnv("QUANTAGENT_SUBMIT_REQUEST_ID", "request.btc.thesis.20260922")
    vi.stubEnv("QUANTAGENT_API_BASE_URL", "http://127.0.0.1:8765")
    vi.stubEnv("QUANTAGENT_API_BEARER_TOKEN", "test-only-token-with-at-least-32-characters")
    accessMock.mockResolvedValue(true)
    submitMock.mockResolvedValue({} as never)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  it("derives one stable server-side idempotency key for repeat clicks", async () => {
    expect(isConfiguredQuantAgentTaskPilot()).toBe(true)
    await submitConfiguredQuantAgentTask()
    await submitConfiguredQuantAgentTask()

    const first = submitMock.mock.calls[0][1]
    const second = submitMock.mock.calls[1][1]
    expect(first).toEqual(second)
    expect(first.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
    expect(first).toMatchObject({ fixtureId: "thesis", fixtureSha256: "a".repeat(64), requestId: "request.btc.thesis.20260922" })
  })

  it("denies another account before contacting the backend", async () => {
    accessMock.mockResolvedValue(false)
    await expect(submitConfiguredQuantAgentTask()).rejects.toMatchObject({ code: "access_denied" })
    expect(submitMock).not.toHaveBeenCalled()
  })

  it("fails closed when the registered fixture metadata is absent", async () => {
    vi.stubEnv("QUANTAGENT_SUBMIT_FIXTURE_SHA256", "")
    expect(isConfiguredQuantAgentTaskPilot()).toBe(false)
    await expect(submitConfiguredQuantAgentTask()).rejects.toMatchObject({ code: "configuration_error" })
    expect(submitMock).not.toHaveBeenCalled()
  })

  it("does not enable writes for an unsafe or missing backend URL", () => {
    vi.stubEnv("QUANTAGENT_API_BASE_URL", "http://example.test")
    expect(isConfiguredQuantAgentTaskPilot()).toBe(false)
    delete process.env.QUANTAGENT_API_BASE_URL
    expect(isConfiguredQuantAgentTaskPilot()).toBe(false)
  })
})
