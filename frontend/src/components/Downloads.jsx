import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2Icon,
  ChevronUpIcon,
  DownloadIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react'
import { triggerScan } from '../api.js'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import CoverArt from './CoverArt.jsx'
import TooltipButton from './TooltipButton.jsx'

const QUALITY_LABEL = {
  best: 'Originale',
  'mp3-320': 'MP3 320',
  'mp3-v0': 'MP3 V0',
  'mp3-192': 'MP3 192',
  'mp3-128': 'MP3 128',
}

const STATUS_BADGE_CLASS = 'h-auto justify-start whitespace-normal text-left'

function StatusBadge({ job }) {
  const quality = QUALITY_LABEL[job.quality] || job.quality
  if (job.status === 'done') {
    return (
      <Badge variant="outline" className={`text-success ${STATUS_BADGE_CLASS}`}>
        <CheckCircle2Icon /> Terminé · {quality}
        {job.scan === 'ok' && ' · scan lancé'}
        {job.playlistId && job.playlist === null && ' · ajout à la playlist…'}
        {job.playlistId && job.playlist === 'ok' && ' · playlist : ok'}
      </Badge>
    )
  }
  if (job.status === 'error') {
    return (
      <Badge variant="destructive">
        <XCircleIcon /> Erreur
      </Badge>
    )
  }
  if (job.status === 'downloading') {
    return (
      <Badge variant="secondary" className="tabular-nums">
        <Spinner aria-label="Téléchargement en cours" />
        {Math.round(job.progress * 100)} % · {quality}
      </Badge>
    )
  }
  return <Badge variant="outline">En attente · {quality}</Badge>
}

function ScanButton() {
  const [state, setState] = useState('idle')
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
    <TooltipButton
      label={
        state === 'error'
          ? 'Échec du scan Navidrome'
          : 'Lancer un scan de la bibliothèque Navidrome'
      }
      variant="ghost"
      size="icon-sm"
      className={
        state === 'ok' ? 'text-success' : state === 'error' ? 'text-destructive' : ''
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
    </TooltipButton>
  )
}

function JobAlert({ children, muted = false }) {
  return (
    <Alert variant={muted ? 'default' : 'destructive'} className="px-3 py-2">
      <AlertDescription className="text-xs break-words">{children}</AlertDescription>
    </Alert>
  )
}

function hasFooter(job) {
  return Boolean(
    job.status === 'downloading' ||
      job.error ||
      (job.scan && job.scan !== 'ok') ||
      (job.playlistId && job.playlist && job.playlist !== 'ok'),
  )
}

function JobCard({ job }) {
  return (
    <Item variant="outline" className="bg-card gap-3 rounded-lg p-3">
      <ItemMedia>
        <CoverArt className="size-10" src={job.thumbnail} />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="line-clamp-1 w-full" title={job.title}>
          {job.title}
        </ItemTitle>
        <ItemDescription className="line-clamp-1 text-xs">
          {job.artist}
          {job.kind !== 'song' && ` · ${job.tracks.length} pistes`}
        </ItemDescription>
        <div className="mt-0.5">
          <StatusBadge job={job} />
        </div>
      </ItemContent>
      {hasFooter(job) && (
        <ItemFooter className="flex-col items-stretch gap-1.5">
          {job.status === 'downloading' && <Progress value={job.progress * 100} />}
          {job.error && <JobAlert>{job.error}</JobAlert>}
          {job.scan && job.scan !== 'ok' && <JobAlert>Scan Navidrome : {job.scan}</JobAlert>}
          {job.playlistId && job.playlist && job.playlist !== 'ok' && (
            <JobAlert muted={job.playlist.startsWith('partiel')}>
              Playlist : {job.playlist.replace(/^partiel : /, 'partiel ')}
            </JobAlert>
          )}
        </ItemFooter>
      )}
    </Item>
  )
}

function JobList({ jobs }) {
  if (jobs.length === 0) {
    return (
      <Empty className="p-4 md:p-4">
        <EmptyDescription>Aucun téléchargement.</EmptyDescription>
      </Empty>
    )
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
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="bg-card fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] shadow-lg lg:hidden"
    >
      <CollapsibleContent>
        <ScrollArea className="[&_[data-slot=scroll-area-viewport]]:max-h-[60dvh]">
          <div className="p-4">
            <JobList jobs={jobs} />
          </div>
        </ScrollArea>
        <Separator />
      </CollapsibleContent>
      <div className="flex items-center gap-2 px-4 py-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="group -mx-2 h-auto min-h-11 flex-1 justify-start gap-2 px-2 py-0 hover:bg-transparent has-[>svg]:px-2 dark:hover:bg-transparent"
          >
            <Title />
            {activeCount > 0 && <Badge>{activeCount}</Badge>}
            <ChevronUpIcon className="text-muted-foreground ml-auto size-4 transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        {navidrome && <ScanButton />}
      </div>
    </Collapsible>
  )
}

export default function Downloads({ jobs, navidrome }) {
  return (
    <>
      <aside className="bg-card/40 sticky top-0 hidden h-dvh w-80 shrink-0 border-l lg:block">
        <ScrollArea className="h-full">
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <Title />
              {navidrome && <ScanButton />}
            </div>
            <JobList jobs={jobs} />
          </div>
        </ScrollArea>
      </aside>
      <MobileDrawer jobs={jobs} navidrome={navidrome} />
    </>
  )
}
