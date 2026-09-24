import { ResearchErrorState } from "@/components/research/ResearchErrorState"
import { ResearchFrame } from "@/components/research/ResearchFrame"
import { TaskProgress } from "@/components/research/TaskProgress"
import { canAccessQuantAgentResearch } from "@/lib/quantagent/server"

export const dynamic = "force-dynamic"

export default async function ResearchTaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  if (!(await canAccessQuantAgentResearch())) {
    return <ResearchFrame showLocator={false}><ResearchErrorState code="access_denied" /></ResearchFrame>
  }
  const { taskId } = await params
  return <ResearchFrame showLocator={false}><TaskProgress taskId={taskId} /></ResearchFrame>
}
