import { BookOpenCheck, ShieldCheck } from "lucide-react"

export function ResearchEmptyState() {
  return (
    <div className="research-empty">
      <div className="research-empty-icon"><BookOpenCheck aria-hidden="true" /></div>
      <div>
        <h2>Open a verified result</h2>
        <p>Enter a QuantAgent run ID to inspect its immutable summary, evidence index, lineage, and Markdown report.</p>
      </div>
      <div className="research-empty-boundary">
        <ShieldCheck aria-hidden="true" />
        <span>Existing results are read-only. The separate controlled task pilot uses one registered offline fixture only.</span>
      </div>
    </div>
  )
}
