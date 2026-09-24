"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LoaderCircle, RotateCw, Square } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { QuantAgentTaskStatus } from "@/lib/quantagent/task-api"

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"])

export function TaskProgress({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<QuantAgentTaskStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()

    async function refresh() {
      try {
        const response = await fetch(`/api/research/tasks/${taskId}`, { cache: "no-store", signal: controller.signal })
        if (!response.ok) throw new Error("Task status is unavailable. You can retry this read without restarting the task.")
        const value = await response.json() as QuantAgentTaskStatus
        if (!active || value.run_id !== taskId) return
        setTask(value)
        setError(null)
        if (!TERMINAL.has(value.status)) timer = setTimeout(refresh, 2_000)
      } catch {
        if (active) setError("Task status is unavailable. Refreshing this page never submits a new task.")
      }
    }

    void refresh()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      controller.abort()
    }
  }, [taskId])

  async function cancel() {
    if (cancelling || !task || TERMINAL.has(task.status)) return
    setCancelling(true)
    setError(null)
    try {
      const response = await fetch(`/api/research/tasks/${taskId}/cancel`, { method: "POST", cache: "no-store" })
      if (!response.ok) {
        const latest = await fetch(`/api/research/tasks/${taskId}`, { cache: "no-store" })
        if (latest.ok) {
          const current = await latest.json() as QuantAgentTaskStatus
          if (current.run_id === taskId) {
            setTask(current)
            if (TERMINAL.has(current.status)) return
          }
        }
        throw new Error("Cancellation could not be recorded. Check status before retrying.")
      }
      const value = await response.json() as QuantAgentTaskStatus
      if (value.run_id !== taskId) throw new Error("The task service returned a mismatched task.")
      setTask(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cancellation could not be recorded.")
    } finally {
      setCancelling(false)
    }
  }

  return (
    <section className="research-panel flex flex-col gap-4 p-5" aria-labelledby="research-task-status-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="research-task-status-title" className="text-lg font-semibold text-foreground">Research task</h2>
          <p className="break-all font-mono text-xs text-muted-foreground">{taskId}</p>
        </div>
        <Badge variant={task?.status === "failed" || task?.status === "interrupted" ? "destructive" : "secondary"}>
          {task?.status ?? "loading"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {!task && !error && "Reading task status…"}
        {task?.status === "queued" && "Queued for the single local worker."}
        {task?.status === "running" && (task.cancel_requested ? "Cancellation requested; the current step may still finish." : "Running the registered offline recipe.")}
        {task?.status === "completed" && "Completed. The verified result is available below."}
        {task?.status === "failed" && "The task failed. The public status contains no raw exception or local path."}
        {task?.status === "cancelled" && "The task was cancelled. Completed step effects are not rolled back."}
        {task?.status === "interrupted" && "The worker stopped before completion. This task will not automatically rerun."}
      </p>
      <div className="flex flex-wrap gap-2">
        {task?.status === "completed" && (
          <Button asChild><Link href={`/research/${taskId}`}>Open verified result</Link></Button>
        )}
        {task && !TERMINAL.has(task.status) && !task.cancel_requested && (
          <Button type="button" variant="outline" onClick={cancel} disabled={cancelling}>
            {cancelling ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Square data-icon="inline-start" />}
            {cancelling ? "Requesting…" : "Request cancellation"}
          </Button>
        )}
        <Button asChild variant="ghost"><Link href="/research"><RotateCw data-icon="inline-start" />Research home</Link></Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
