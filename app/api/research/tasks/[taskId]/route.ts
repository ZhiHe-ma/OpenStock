import { readConfiguredQuantAgentTask } from "@/lib/quantagent/task-server"
import { taskError, taskJson } from "@/lib/quantagent/task-route"

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    return taskJson(await readConfiguredQuantAgentTask((await params).taskId))
  } catch (error) {
    return taskError(error)
  }
}
