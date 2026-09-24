"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FlaskConical, LoaderCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const TASK_ID = /^task-[a-f0-9]{32}$/

export function TaskLauncher({ configured }: { configured: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (pending || !configured) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch("/api/research/tasks", { method: "POST", cache: "no-store" })
      if (!response.ok) throw new Error("The controlled task could not be admitted. Check the server configuration and retry.")
      const task: unknown = await response.json()
      if (!task || typeof task !== "object" || !("run_id" in task) || typeof task.run_id !== "string" || !TASK_ID.test(task.run_id)) {
        throw new Error("The task service returned an unsupported response.")
      }
      router.push(`/research/tasks/${task.run_id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The task service is unavailable.")
      setPending(false)
    }
  }

  return (
    <section className="research-panel flex flex-col gap-4 p-5" aria-labelledby="research-task-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="research-task-title" className="text-lg font-semibold text-foreground">Controlled offline research</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Run one server-registered thesis fixture. The request cannot choose files, plugins, models, or trading actions.
          </p>
        </div>
        <Badge variant="secondary">Single-account pilot</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={!configured || pending}>
          {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <FlaskConical data-icon="inline-start" />}
          {pending ? "Opening task…" : "Run registered research"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {configured ? "Retries reuse the same task; refreshing does not start another run." : "Disabled until the server operator registers the offline fixture."}
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
