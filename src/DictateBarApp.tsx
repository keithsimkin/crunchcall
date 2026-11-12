import { useState } from 'react'
import { DictatePopup } from './ui/DictatePopup'
import { useSettingsState } from './ui/settingsState'
import './App.css'

/** Tiny always-on-top shell for system-wide dictation (Electron). */
export default function DictateBarApp() {
  const settings = useSettingsState()
  const [open, setOpen] = useState(true)

  return (
    <div className="dictate-bar-root" data-desktop="true">
      <DictatePopup
        speechId={settings.speechId}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) window.crunchcall?.hideDictateBar?.()
        }}
      />
    </div>
  )
}
