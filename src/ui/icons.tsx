import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Stroke({ children, className, ...rest }: { children: ReactNode } & IconProps) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      {...rest}
    >
      {children}
    </svg>
  )
}

const pen = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect className="logo-mark__bg" width="64" height="64" rx="16" />
      <g className="logo-mark__face">
        <circle cx="20" cy="18.5" r="11" />
        <circle cx="44" cy="18.5" r="11" />
        <path d="M12 36.5c.4-8 7.6-13 20-13s19.6 5 20 13c.7 8.2-4.6 16.2-20 16.2S11.3 44.7 12 36.5z" />
      </g>
      <g className="logo-mark__eye">
        <circle cx="20" cy="19.4" r="4.15" />
        <circle cx="44" cy="19.4" r="4.15" />
      </g>
      <g className="logo-mark__shine">
        <circle cx="21.35" cy="18.15" r="1.25" />
        <circle cx="45.35" cy="18.15" r="1.25" />
      </g>
      <path
        className="logo-mark__mouth"
        d="M23.2 42.2c2.9 3.5 14.7 3.5 17.6 0"
        fill="none"
        strokeWidth="2.45"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function HomeIcon() {
  return (
    <Stroke>
      <path d="M4 11.5 12 4.5l8 7V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z" {...pen} />
    </Stroke>
  )
}

export function MeetingsIcon() {
  return (
    <Stroke>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" {...pen} />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" {...pen} />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" {...pen} />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" {...pen} />
    </Stroke>
  )
}

export function LiveIcon() {
  return (
    <Stroke>
      <circle cx="12" cy="12" r="7.25" {...pen} />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </Stroke>
  )
}

export function MicIcon() {
  return (
    <Stroke>
      <rect x="9" y="3.5" width="6" height="10" rx="3" {...pen} />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" {...pen} />
      <path d="M12 17v3.5M8.5 20.5h7" {...pen} />
    </Stroke>
  )
}

export function FolderIcon() {
  return (
    <Stroke>
      <path d="M3.5 8.2V17a1.6 1.6 0 0 0 1.6 1.6h13.8a1.6 1.6 0 0 0 1.6-1.6V9.4a1.6 1.6 0 0 0-1.6-1.6H11L9.2 6.1A1.6 1.6 0 0 0 8 5.5H5.1A1.6 1.6 0 0 0 3.5 7.1v1.1Z" {...pen} />
    </Stroke>
  )
}

export function ShortcutIcon() {
  return (
    <Stroke>
      <rect x="3.5" y="6" width="17" height="12" rx="2" {...pen} />
      <path d="M7 15h10M8 10h2.2M11.4 10H14M15.2 10H17" {...pen} />
    </Stroke>
  )
}

export function CalendarIcon() {
  return (
    <Stroke>
      <rect x="4" y="5" width="16" height="14.5" rx="2" {...pen} />
      <path d="M8 3.5V6.5M16 3.5V6.5M4 9.5h16" {...pen} />
    </Stroke>
  )
}

export function ListenIcon() {
  return (
    <Stroke>
      <path d="M4 12a8 8 0 0 1 16 0" {...pen} />
      <path d="M4 12v3.2A2.3 2.3 0 0 0 6.3 17.5H8v-6H6.2A2.2 2.2 0 0 0 4 13.7V12Z" {...pen} />
      <path d="M20 12v3.2a2.3 2.3 0 0 1-2.3 2.3H16v-6h1.8A2.2 2.2 0 0 1 20 13.7V12Z" {...pen} />
    </Stroke>
  )
}

export function KeyIcon() {
  return (
    <Stroke>
      <circle cx="8" cy="12" r="3.2" {...pen} />
      <path d="M11 12h9M16.5 12v2.2M19 12v1.6" {...pen} />
    </Stroke>
  )
}

export function PcIcon() {
  return (
    <Stroke>
      <rect x="3.5" y="4.5" width="17" height="11" rx="1.6" {...pen} />
      <path d="M8 19.5h8M12 15.5v4" {...pen} />
    </Stroke>
  )
}

export function GearIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        {...pen}
      />
      <circle cx="12" cy="12" r="3" {...pen} />
    </Stroke>
  )
}

export function PlusIcon() {
  return (
    <Stroke>
      <path d="M12 5.5v13M5.5 12h13" {...pen} />
    </Stroke>
  )
}

export function ExportIcon() {
  return (
    <Stroke>
      <path d="M12 4.5v9" {...pen} />
      <path d="M8.5 8 12 4.5 15.5 8" {...pen} />
      <path d="M5.5 13.5v4.2a1.3 1.3 0 0 0 1.3 1.3h10.4a1.3 1.3 0 0 0 1.3-1.3v-4.2" {...pen} />
    </Stroke>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <circle cx="11" cy="11" r="6" {...pen} />
      <path d="M15.8 15.8 20 20" {...pen} />
    </Stroke>
  )
}

export function PlugIcon() {
  return (
    <Stroke>
      <path d="M9 3.5v4.8M15 3.5v4.8" {...pen} />
      <path d="M6.5 8.3h11v3a5.5 5.5 0 0 1-11 0v-3Z" {...pen} />
      <path d="M12 16.8v3.7" {...pen} />
    </Stroke>
  )
}

export function ExternalLinkIcon({ className }: { className?: string } = {}) {
  return (
    <Stroke className={className} width="14" height="14">
      <path d="M14 10v6.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 16.5v-9A1.5 1.5 0 0 1 3.5 6H10" {...pen} />
      <path d="M15 3h6v6M21 3l-9 9" {...pen} />
    </Stroke>
  )
}

export function SparkIcon() {
  return (
    <Stroke>
      <path d="M12 3.5 13.6 8l4.4 1.6-4.4 1.6L12 15.7 10.4 11.2 6 9.6 10.4 8 12 3.5Z" {...pen} />
      <path d="M18.2 15.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9Z" {...pen} />
    </Stroke>
  )
}

export function FilterIcon() {
  return (
    <Stroke>
      <path d="M4 7h16M7 12h10M10 17h4" {...pen} />
    </Stroke>
  )
}

export function PencilIcon() {
  return (
    <Stroke>
      <path d="M4.5 19.5 5.2 15l9.4-9.4a1.6 1.6 0 0 1 2.3 0l1.5 1.5a1.6 1.6 0 0 1 0 2.3L9 18.8l-4.5.7Z" {...pen} />
    </Stroke>
  )
}

export function TrashIcon() {
  return (
    <Stroke>
      <path d="M5 7.5h14" {...pen} />
      <path d="M9.2 7.4V5.8A1.3 1.3 0 0 1 10.5 4.5h3a1.3 1.3 0 0 1 1.3 1.3v1.6" {...pen} />
      <path d="M7.2 7.5l.7 11a1.4 1.4 0 0 0 1.4 1.3h5.4a1.4 1.4 0 0 0 1.4-1.3l.7-11" {...pen} />
    </Stroke>
  )
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <Stroke className={className} width="14" height="14">
      <path d="m6.5 9.5 5.5 5 5.5-5" {...pen} />
    </Stroke>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Stroke className={className} width="14" height="14">
      <path d="m5 12.5 4.5 4.5L19 7" {...pen} />
    </Stroke>
  )
}

export function EyeIcon({ className }: IconProps) {
  return (
    <Stroke className={className} width="16" height="16">
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" {...pen} />
      <circle cx="12" cy="12" r="3.2" {...pen} />
    </Stroke>
  )
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <Stroke className={className} width="16" height="16">
      <path d="M4 4 20 20" {...pen} />
      <path d="M9.9 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9" {...pen} />
      <path d="M6.3 7.6A17.3 17.3 0 0 0 2.5 12s3.5 6.2 9.5 6.2a10 10 0 0 0 3.5-.6" {...pen} />
      <path d="M10.2 10.2a2.6 2.6 0 0 0 3.6 3.6" {...pen} />
    </Stroke>
  )
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <Stroke className={className} width="15" height="15">
      <path d="M12 4v9" {...pen} />
      <path d="m8.5 10.5 3.5 3.5 3.5-3.5" {...pen} />
      <path d="M5.5 17.5v1.2a1.3 1.3 0 0 0 1.3 1.3h10.4a1.3 1.3 0 0 0 1.3-1.3v-1.2" {...pen} />
    </Stroke>
  )
}

export function MoreIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Stroke>
  )
}

export function ShareIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M4 12v7.2A1.8 1.8 0 0 0 5.8 21h12.4a1.8 1.8 0 0 0 1.8-1.8V12" {...pen} />
      <path d="M12 3.5v11" {...pen} />
      <path d="m8 7.5 4-4 4 4" {...pen} />
    </Stroke>
  )
}

export function RestoreIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" {...pen} />
      <path d="M4.5 4.5v4.2H8.7" {...pen} />
    </Stroke>
  )
}

export function SupportIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M3.5 10.5v3a1.2 1.2 0 0 0 1.2 1.2H6l3.3 3.8a.8.8 0 0 0 1.4-.5V6a.8.8 0 0 0-1.4-.5L7.2 9.3H4.7A1.2 1.2 0 0 0 3.5 10.5Z" {...pen} />
      <path d="M14.2 8.2a4.2 4.2 0 0 1 0 7.6" {...pen} />
      <path d="M16.6 6.2a7 7 0 0 1 0 11.6" {...pen} />
    </Stroke>
  )
}

export function HelpIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <circle cx="12" cy="12" r="8.25" {...pen} />
      <path d="M9.8 9.4a2.4 2.4 0 1 1 3.5 2.1c-.8.5-1.3 1-1.3 2" {...pen} />
      <path d="M12 16.6h.01" {...pen} />
    </Stroke>
  )
}
