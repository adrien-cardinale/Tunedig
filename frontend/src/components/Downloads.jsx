import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2Icon,
  ChevronUpIcon,
  DownloadIcon,
  Loader2Icon,
  MusicIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react'
import { triggerScan } from '../api.js'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

const QUALITY_LABEL = {
  best: 'Originale',
  'mp3-320': 'MP3 320',
  'mp3-v0': 'MP3 V0',
  'mp3-192': 'MP3 192',
  'mp3-128': 'MP3 128',
}

function StatusLine({ job }) {
  const quality = QUALITY_LABEL[job.quality] || job.quality
  if (job.status === 'done') {
    return (
      <span className="text-success flex items-center gap-1">
        <CheckCircle2Icon className="size-3.5" /> Terminé · {quality}
        {job.scan === 'ok' && ' · scan lancé'}
      </span>
    )
  }
  if (job.status === 'error') {
    return (
      <span className="text-destructive flex items-center gap-1">
        <XCircleIcon className="size-3.5" /> Erreur
      </span>
    )
  }
  if (job.status === 'downloading') {
    return (
      <span className="text-muted-foreground flex items-center gap-1">
        <Loader2Icon className="size-3.5 animate-spin" />
        {Math.round(job.progress * 100)} % · {quality}
      </span>
    )
  }
  return <span className="text-muted-foreground">En attente · {quality}</span>
}

function ScanButton() {
  const [state, setState] = useState('idle') // idle | busy | ok | error
  const timer = useRef(null)

  const scan = async () => {
    setState('busy')
    clearTimeout(timer.current)
    try {
      await triggerScan()
      setState('ok')
    } catch {
      setState('error')
    }
    timer.current = setTimeout(() => setState('idle'), 3000)
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={
        state === 'ok' ? 'text-success' : state === 'error' ? 'text-destructive' : ''
      }
      title={
        state === 'error'
          ? 'Échec du scan Navidrome'
          : 'Lancer un scan de la bibliothèque Navidrome'
      }
      disabled={state === 'busy'}
      onClick={scan}
    >
      {state === 'ok' ? (
        <CheckCircle2Icon />
      ) : state === 'error' ? (
        <XCircleIcon />
      ) : (
        <RefreshCwIcon className={state === 'busy' ? 'animate-spin' : ''} />
      )}
    </Button>
  )
}

function JobCard({ job }) {
  return (
    <div className="bg-card space-y-2.5 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        {job.thumbnail ? (
          <img className="size-10 shrink-0 rounded-md object-cover" src={job.thumbnail} alt="" />
        ) : (
          <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
            <MusicIcon className="size-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={job.title}>
            {job.title}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {job.artist}
            {job.kind === 'album' && ` · ${job.tracks.length} pistes`}
          </p>
          <div className="mt-0.5 text-xs">
            <StatusLine job={job} />
          </div>
        </div>
      </div>
      {job.status === 'downloading' && <Progress value={job.progress * 100} />}
      {job.error && <p className="text-destructive text-xs break-words">{job.error}</p>}
      {job.scan && job.scan !== 'ok' && (
        <p className="text-destructive text-xs break-words">Scan Navidrome : {job.scan}</p>
      )}
    </div>
  )
}

function JobList({ jobs }) {
  if (jobs.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun téléchargement.</p>
  }
  return (
    <div className="space-y-2.5">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  )
}

function Title() {
  return (
    <h2 className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
      <DownloadIcon className="size-3.5" />
      Téléchargements
    </h2>
  )
}

function MobileDrawer({ jobs, navidrome }) {
  const [open, setOpen] = useState(false)
  const previousCount = useRef(jobs.length)
  const activeCount = jobs.filter((j) => j.status !== 'done' && j.status !== 'error').length

  useEffect(() => {
    if (jobs.length > previousCount.current) setOpen(true)
    previousCount.current = jobs.length
  }, [jobs.length])

  return (
    <div className="bg-card fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] shadow-lg lg:hidden">
      {open && (
        <div className="max-h-[60dvh] overflow-y-auto border-b p-4">
          <JobList jobs={jobs} />
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          className="flex min-h-11 flex-1 cursor-pointer items-center gap-2"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Title />
          {activeCount > 0 && <Badge>{activeCount}</Badge>}
          <ChevronUpIcon
            className={cn(
              'text-muted-foreground ml-auto size-4 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
        {navidrome && <ScanButton />}
      </div>
    </div>
  )
}

export default function Downloads({ jobs, navidrome }) {
  return (
    <>
      <aside className="bg-card/40 sticky top-0 hidden h-dvh w-80 shrink-0 overflow-y-auto border-l p-5 lg:block">
        <div className="mb-4 flex items-center justify-between">
          <Title />
          {navidrome && <ScanButton />}
        </div>
        <JobList jobs={jobs} />
      </aside>
      <MobileDrawer jobs={jobs} navidrome={navidrome} />
    </>
  )
}
