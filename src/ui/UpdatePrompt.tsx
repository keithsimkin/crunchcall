export function UpdatePrompt({
  latest,
  onOpen,
  onDismiss,
}: {
  latest: string
  onOpen: () => void
  onDismiss: () => void
}) {
  return (
    <div className="update-pop" role="status">
      <button type="button" className="update-pop-go" onClick={onOpen}>
        Update the app.
        <span className="sr">{latest} is on GitHub.</span>
      </button>
      <button type="button" className="update-pop-x" aria-label="Dismiss update" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
