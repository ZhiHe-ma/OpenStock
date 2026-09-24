import "server-only"

import { createHash } from "node:crypto"

import { canAccessQuantAgentResearch } from "@/lib/quantagent/server"
import { normalizeQuantAgentBaseUrl } from "@/lib/quantagent/read-api"
import {
  cancelQuantAgentTask,
  getQuantAgentTaskStatus,
  QuantAgentTaskError,
  submitQuantAgentTask,
  type QuantAgentFixedSubmission,
} from "@/lib/quantagent/task-api"

const FIXTURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SHA256 = /^[a-f0-9]{64}$/

function fixedSubmission(): QuantAgentFixedSubmission | null {
  const fixtureId = process.env.QUANTAGENT_SUBMIT_FIXTURE_ID ?? ""
  const fixtureSha256 = process.env.QUANTAGENT_SUBMIT_FIXTURE_SHA256 ?? ""
  const requestId = process.env.QUANTAGENT_SUBMIT_REQUEST_ID ?? ""
  const allowedUserId = process.env.QUANTAGENT_ALLOWED_USER_ID ?? ""
  if (!FIXTURE_ID.test(fixtureId) || !SHA256.test(fixtureSha256) || !FIXTURE_ID.test(requestId) || !allowedUserId || allowedUserId.trim() !== allowedUserId) {
    return null
  }
  const idempotencyKey = createHash("sha256")
    .update(JSON.stringify(["openstock.p3c.v1", allowedUserId, fixtureId, fixtureSha256, requestId]))
    .digest("hex")
  return { fixtureId, fixtureSha256, requestId, idempotencyKey }
}

export function isConfiguredQuantAgentTaskPilot(): boolean {
  if (!fixedSubmission() || !process.env.QUANTAGENT_API_BASE_URL || !process.env.QUANTAGENT_API_BEARER_TOKEN?.trim() || process.env.QUANTAGENT_API_BEARER_TOKEN.length < 32) {
    return false
  }
  try {
    normalizeQuantAgentBaseUrl(process.env.QUANTAGENT_API_BASE_URL)
    return true
  } catch {
    return false
  }
}

function config() {
  return {
    baseUrl: process.env.QUANTAGENT_API_BASE_URL ?? "",
    bearerToken: process.env.QUANTAGENT_API_BEARER_TOKEN ?? "",
  }
}

async function requireResearchAccount() {
  if (!(await canAccessQuantAgentResearch())) throw new QuantAgentTaskError("access_denied", 403)
}

export async function submitConfiguredQuantAgentTask() {
  await requireResearchAccount()
  const submission = fixedSubmission()
  if (!submission) throw new QuantAgentTaskError("configuration_error")
  return submitQuantAgentTask(config(), submission)
}

export async function readConfiguredQuantAgentTask(taskId: string) {
  await requireResearchAccount()
  return getQuantAgentTaskStatus(config(), taskId)
}

export async function cancelConfiguredQuantAgentTask(taskId: string) {
  await requireResearchAccount()
  return cancelQuantAgentTask(config(), taskId)
}
