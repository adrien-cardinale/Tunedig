import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDownIcon,
  HeartIcon,
  MusicIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react'
import * as api from '../api.js'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const STATUS = {
  pending: { label: 'En cours', variant: 'secondary' },
  downloaded: { label: 'Téléchargée', variant: 'secondary' },
  existing: { label: 'Déjà présente', variant: 'outline' },
  unmatched: { label: 'Introuvable sur YouTube', variant: 'outline' },
  error: { label: 'Erreur', variant: 'destructive' },
  deleted: { label: 'Supprimée', variant: 'outline' },
}

const DECIDABLE = ['downloaded', 'existing']
const RETRYABLE = ['error', 'unmatched']

function formatDate(date) {
  if (!date) return ''
  return new Date(date).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function countDecisions(playlists) {
  const tracks = playlists.flatMap((p) => p.tracks)
  return {
    pending: tracks.filter((t) => DECIDABLE.includes(t.status) && !t.decision).length,
    kept: tracks.filter((t) => t.decision === 'keep').length,
    discarded: tracks.filter((t) => t.decision === 'discard').length,
    failed: tracks.filter((t) => RETRYABLE.includes(t.status)).length,
  }
}

function hasPendingTracks(playlists) {
  return (playlists || []).some((p) => p.tracks.some((t) => t.status === 'pending'))
}

function retryMessage(count) {
  return `${count} piste(s) relancée(s).`
}

function syncMessage(result) {
  if (!result.playlist) return 'Aucune playlist Weekly Exploration disponible.'
  if (result.new) return `Nouvelle playlist « ${result.playlist} » : recherche des titres en cours…`
  return `« ${result.playlist} » est déjà synchronisée.`
}

function DecisionButtons({ track, busy, onDecide }) {
  const discardTitle =
    track.status === 'existing'
      ? 'Marquer comme non gardée (fichier conservé)'
      : 'Supprimer le fichier'
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="icon-sm"
        variant={track.decision === 'keep' ? 'default' : 'ghost'}
        title="Garder"
        aria-label="Garder"
        disabled={busy}
        onClick={() => onDecide(track, 'keep')}
      >
        <HeartIcon />
      </Button>
      <Button
        size="icon-sm"
        variant={track.decision === 'discard' ? 'default' : 'ghost'}
        title={discardTitle}
        aria-label={discardTitle}
        disabled={busy}
        onClick={() => onDecide(track, 'discard')}
      >
        <Trash2Icon />
      </Button>
    </div>
  )
}

function RetryButton({ track, busy, onRetry }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="shrink-0"
      title="Réessayer"
      aria-label="Réessayer"
      disabled={busy}
      onClick={() => onRetry(track)}
    >
      <RotateCcwIcon />
    </Button>
  )
}

function TrackRow({ track, busy, onDecide, onRetry }) {
  const status = STATUS[track.status] || { label: track.status, variant: 'outline' }
  const deleted = track.status === 'deleted'
  return (
    <div
      className={cn(
        'bg-card flex items-center gap-3 rounded-xl border p-3',
        deleted && 'opacity-60',
      )}
    >
      {track.thumbnail ? (
        <img
          className="size-12 shrink-0 rounded-md object-cover"
          src={track.thumbnail}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded-md">
          <MusicIcon className="size-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={track.title}>
          {track.title}
        </p>
        <p
          className="text-muted-foreground truncate text-sm"
          title={[track.artist, track.album].filter(Boolean).join(' · ')}
        >
          {track.artist}
          {track.album && ` · ${track.album}`}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant={status.variant} title={track.error || undefined}>
            {status.label}
          </Badge>
        </div>
      </div>
      {DECIDABLE.includes(track.status) && (
        <DecisionButtons track={track} busy={busy} onDecide={onDecide} />
      )}
      {RETRYABLE.includes(track.status) && (
        <RetryButton track={track} busy={busy} onRetry={onRetry} />
      )}
    </div>
  )
}

function TrackList({ tracks, busyId, onDecide, onRetry, processing = false }) {
  if (tracks.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-sm">
        {processing ? 'Recherche des titres en cours…' : 'Aucune nouvelle piste.'}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {tracks.map((t) => (
        <TrackRow
          key={t.mbid}
          track={t}
          busy={busyId === t.mbid}
          onDecide={onDecide}
          onRetry={onRetry}
        />
      ))}
    </div>
  )
}

function OlderPlaylist({ playlist, busyId, onDecide, onRetry }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="border-t pt-4">
      <button
        type="button"
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{playlist.title}</span>
          <span className="text-muted-foreground text-xs">
            {formatDate(playlist.date)} · {playlist.tracks.length} pistes
          </span>
        </span>
        <ChevronDownIcon
          className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="mt-3">
          <TrackList
            tracks={playlist.tracks}
            busyId={busyId}
            onDecide={onDecide}
            onRetry={onRetry}
          />
        </div>
      )}
    </section>
  )
}

function Header({ latest, counts, syncing, onSync, retrying, onRetryAll }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold" title={latest?.title}>
          {latest ? latest.title : 'Weekly Exploration'}
        </h2>
        <p className="text-muted-foreground text-sm">
          {latest && `${formatDate(latest.date)} · `}
          {counts.pending} à trier · {counts.kept} gardées · {counts.discarded} supprimées
          {counts.failed > 0 && ` · ${counts.failed} en échec`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {counts.failed > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={retrying}
            onClick={onRetryAll}
            aria-label="Relancer les échecs"
          >
            <RotateCcwIcon />
            <span className="hidden sm:inline">Relancer les échecs</span>
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={syncing}
          onClick={onSync}
          aria-label="Synchroniser"
        >
          <RefreshCwIcon className={syncing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Synchroniser</span>
        </Button>
      </div>
    </div>
  )
}

export default function Weekly({ jobs }) {
  const [playlists, setPlaylists] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [awaitedPlaylist, setAwaitedPlaylist] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [retrying, setRetrying] = useState(false)

  const jobRunning = jobs.some(
    (j) => j.kind === 'playlist' && (j.status === 'queued' || j.status === 'downloading'),
  )
  const tracksPending = hasPendingTracks(playlists)

  const refresh = useCallback(async () => {
    try {
      setPlaylists(await api.getListenbrainzTracks())
    } catch (e) {
      setError(`Chargement impossible : ${e.message}`)
    }
  }, [])

  useEffect(() => {
    refresh()
    if (!jobRunning && !awaitedPlaylist && !tracksPending) return
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [jobRunning, awaitedPlaylist, tracksPending, refresh])

  useEffect(() => {
    if (!awaitedPlaylist || !playlists) return
    const playlist = playlists.find((p) => p.mbid === awaitedPlaylist)
    if (!playlist || playlist.processedAt) setAwaitedPlaylist(null)
  }, [awaitedPlaylist, playlists])

  const sync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const result = await api.syncListenbrainz()
      setMessage(syncMessage(result))
      if (result.new) setAwaitedPlaylist(result.mbid)
      await refresh()
    } catch (e) {
      setError(`Synchronisation impossible : ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const decide = async (track, decision) => {
    setBusyId(track.mbid)
    setError(null)
    try {
      const updated = await api.decideListenbrainzTrack(track.mbid, decision)
      setPlaylists((current) =>
        current.map((p) => ({
          ...p,
          tracks: p.tracks.map((t) => (t.mbid === updated.mbid ? updated : t)),
        })),
      )
    } catch (e) {
      setError(`Action impossible : ${e.message}`)
    } finally {
      setBusyId(null)
    }
  }

  const retryTrack = async (track) => {
    setBusyId(track.mbid)
    setError(null)
    try {
      const { count } = await api.retryListenbrainzTrack(track.mbid)
      setMessage(retryMessage(count))
      await refresh()
    } catch (e) {
      setError(`Relance impossible : ${e.message}`)
    } finally {
      setBusyId(null)
    }
  }

  const retryAll = async () => {
    setRetrying(true)
    setError(null)
    try {
      const { count } = await api.retryListenbrainz()
      setMessage(retryMessage(count))
      await refresh()
    } catch (e) {
      setError(`Relance impossible : ${e.message}`)
    } finally {
      setRetrying(false)
    }
  }

  if (playlists === null && !error) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
    )
  }

  const [latest, ...older] = playlists || []

  return (
    <div>
      <Header
        latest={latest}
        counts={countDecisions(playlists || [])}
        syncing={syncing}
        onSync={sync}
        retrying={retrying}
        onRetryAll={retryAll}
      />
      {message && (
        <p
          className="bg-muted text-muted-foreground mb-4 cursor-pointer rounded-lg px-4 py-3 text-sm"
          onClick={() => setMessage(null)}
          title="Cliquer pour fermer"
        >
          {message}
        </p>
      )}
      {error && (
        <div
          className="border-destructive/50 bg-destructive/10 text-destructive mb-4 cursor-pointer rounded-lg border px-4 py-3 text-sm"
          onClick={() => setError(null)}
          title="Cliquer pour fermer"
        >
          {error}
        </div>
      )}
      {latest ? (
        <div className="space-y-4">
          <TrackList
            tracks={latest.tracks}
            busyId={busyId}
            onDecide={decide}
            onRetry={retryTrack}
            processing={!latest.processedAt}
          />
          {older.map((p) => (
            <OlderPlaylist
              key={p.mbid}
              playlist={p}
              busyId={busyId}
              onDecide={decide}
              onRetry={retryTrack}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground py-20 text-center text-sm">
          Aucune playlist pour l’instant. Lancez une synchronisation.
        </p>
      )}
    </div>
  )
}
