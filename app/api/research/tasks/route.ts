import { submitConfiguredQuantAgentTask } from "@/lib/quantagent/task-server"
import { isSameOriginWrite, taskError, taskJson } from "@/lib/quantagent/task-route"
import { QuantAgentTaskError } from "@/lib/quantagent/task-api"

export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return taskError(new QuantAgentTaskError("access_denied"))
  try {
    return taskJson(await submitConfiguredQuantAgentTask())
  } catch (error) {
    return taskError(error)
  }
}
