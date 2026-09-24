import { cancelConfiguredQuantAgentTask } from "@/lib/quantagent/task-server"
import { isSameOriginWrite, taskError, taskJson } from "@/lib/quantagent/task-route"
import { QuantAgentTaskError } from "@/lib/quantagent/task-api"

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  if (!isSameOriginWrite(request)) return taskError(new QuantAgentTaskError("access_denied"))
  try {
    return taskJson(await cancelConfiguredQuantAgentTask((await params).taskId))
  } catch (error) {
    return taskError(error)
  }
}
