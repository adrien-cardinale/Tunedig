import { useSyncExternalStore } from 'react'
import { DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const OPTIONS = [
  { id: 'best', label: 'Originale' },
  { id: 'mp3-320', label: 'MP3 320' },
  { id: 'mp3-v0', label: 'MP3 V0' },
  { id: 'mp3-192', label: 'MP3 192' },
  { id: 'mp3-128', label: 'MP3 128' },
]

let quality = localStorage.getItem('yt-get-quality') || 'best'
const listeners = new Set()

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const setQuality = (q) => {
  quality = q
  localStorage.setItem('yt-get-quality', q)
  listeners.forEach((fn) => fn())
}

export default function DownloadMenu({
  onDownload,
  compact = false,
  label = 'Télécharger',
  className,
}) {
  const q = useSyncExternalStore(subscribe, () => quality)
  return (
    <div className={cn('flex items-center gap-2', className)} onClick={(e) => e.stopPropagation()}>
      <Select value={q} onValueChange={setQuality}>
        <SelectTrigger
          size="sm"
          className={compact ? 'hidden w-[110px] sm:flex' : 'w-[120px] shrink-0'}
          title="Qualité — « Originale » : Opus/M4A sans réencodage"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {compact ? (
        <Button size="icon-sm" variant="secondary" title="Télécharger" onClick={() => onDownload(q)}>
          <DownloadIcon />
        </Button>
      ) : (
        <Button className="flex-1 sm:flex-none" onClick={() => onDownload(q)}>
          <DownloadIcon />
          {label}
        </Button>
      )}
    </div>
  )
}
