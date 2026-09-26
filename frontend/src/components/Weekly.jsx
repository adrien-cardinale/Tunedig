import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDownIcon,
  HeartIcon,
  ListPlusIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react'
import * as api from '../api.js'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { reloadPlaylists, usePlaylists } from './DownloadMenu.jsx'
import Player from './Player.jsx'
import SelectionBar from './SelectionBar.jsx'

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
const NEW_PLAYLIST = '__new__'

function formatDate(date) {
  if (!date) return ''
  return new Date(date).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function isPlayable(track) {
  return Boolean(track.path) && DECIDABLE.includes(track.status)
}

function isMoved(track) {
  return Boolean(track.movedTo) && track.decision !== 'discard'
}

function visibleTracks(playlist) {
  return playlist.tracks.filter((t) => !isMoved(t))
}

function nextPlayable(playlists, track) {
  const playlist = (playlists || []).find((p) => p.tracks.some((t) => t.mbid === track.mbid))
  if (!playlist) return null
  const index = playlist.tracks.findIndex((t) => t.mbid === track.mbid)
  return playlist.tracks.slice(index + 1).find((t) => isPlayable(t) && !isMoved(t)) || null
}

function countDecisions(playlists) {
  const tracks = playlists.flatMap((p) => p.tracks)
  return {
    pending: tracks.filter((t) => DECIDABLE.includes(t.status) && !t.decision).length,
    kept: tracks.filter((t) => t.decision === 'keep').length,
    discarded: tracks.filter((t) => t.decision === 'discard').length,
    moved: tracks.filter(isMoved).length,
    failed: tracks.filter((t) => RETRYABLE.includes(t.status)).length,
  }
}

function hasPendingTracks(playlists) {
  return (playlists || []).some((p) => p.tracks.some((t) => t.status === 'pending'))
}

function decidableTracks(playlists) {
  return (playlists || []).flatMap(visibleTracks).filter((t) => DECIDABLE.includes(t.status))
}

function pluralize(count, word) {
  return count > 1 ? `${word}s` : word
}

function countLabel(count, ...words) {
  return `${count} ${words.map((word) => pluralize(count, word)).join(' ')}`
}

function moveDescription(tracks, navidromePlaylist) {
  if (tracks.length === 1) return `« ${tracks[0].title} » quittera ${navidromePlaylist}.`
  return `${tracks.length} pistes quitteront ${navidromePlaylist}.`
}

function retryMessage(count) {
  return `${count} piste(s) relancée(s).`
}

function syncMessage(result) {
  if (!result.playlist) return 'Aucune playlist Weekly Exploration disponible.'
  if (result.new) return `Nouvelle playlist « ${result.playlist} » : recherche des titres en cours…`
  return `« ${result.playlist} » est déjà synchronisée.`
}

function DecisionButtons({ track, busy, onDecide, onMove }) {
  const discardTitle =
    track.status === 'existing'
      ? 'Marquer comme non gardée (fichier conservé)'
      : 'Supprimer le fichier'
  return (
    <div className="flex shrink-0 items-center gap-1">
      {onMove && (
        <Button
          size="icon-sm"
          variant="ghost"
          title="Déplacer vers une playlist…"
          aria-label="Déplacer vers une playlist…"
          disabled={busy}
          onClick={() => onMove(track)}
        >
          <ListPlusIcon />
        </Button>
      )}
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

function PlayButton({ track, active, onPlay }) {
  const label = active ? 'Pause' : 'Écouter'
  return (
    <Button
      size="icon"
      variant="ghost"
      className="shrink-0"
      title={label}
      aria-label={label}
      onClick={() => onPlay(track)}
    >
      {active ? <PauseIcon /> : <PlayIcon />}
    </Button>
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

function SelectCheckbox({ track, checked, busy, onToggleSelect }) {
  return (
    <input
      type="checkbox"
      className="accent-primary size-4 shrink-0 cursor-pointer"
      aria-label={`Sélectionner « ${track.title} »`}
      checked={checked}
      disabled={busy}
      onChange={() => onToggleSelect(track.mbid)}
    />
  )
}

function TrackRow({
  track,
  busy,
  current,
  playing,
  checked,
  onDecide,
  onRetry,
  onMove,
  onPlay,
  onToggleSelect,
}) {
  const status = STATUS[track.status] || { label: track.status, variant: 'outline' }
  const deleted = track.status === 'deleted'
  const decidable = DECIDABLE.includes(track.status)
  return (
    <div
      className={cn(
        'bg-card flex items-center gap-3 rounded-xl border p-3',
        deleted && 'opacity-60',
        current && 'ring-primary/40 ring-1',
      )}
    >
      {onToggleSelect &&
        (decidable ? (
          <SelectCheckbox
            track={track}
            checked={checked}
            busy={busy}
            onToggleSelect={onToggleSelect}
          />
        ) : (
          <span className="size-4 shrink-0" />
        ))}
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
      {isPlayable(track) && (
        <PlayButton track={track} active={current && playing} onPlay={onPlay} />
      )}
      {decidable && (
        <DecisionButtons track={track} busy={busy} onDecide={onDecide} onMove={onMove} />
      )}
      {RETRYABLE.includes(track.status) && (
        <RetryButton track={track} busy={busy} onRetry={onRetry} />
      )}
    </div>
  )
}

function TrackList({
  tracks,
  busyId,
  batchBusy,
  currentMbid,
  playing,
  selected,
  onDecide,
  onRetry,
  onMove,
  onPlay,
  onToggleSelect,
  processing = false,
}) {
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
          busy={busyId === t.mbid || batchBusy}
          current={currentMbid === t.mbid}
          playing={playing}
          checked={selected.has(t.mbid)}
          onDecide={onDecide}
          onRetry={onRetry}
          onMove={onMove}
          onPlay={onPlay}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  )
}

function OlderPlaylist({ playlist, ...listProps }) {
  const [open, setOpen] = useState(false)
  const tracks = visibleTracks(playlist)
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
            {formatDate(playlist.date)} · {tracks.length} pistes
          </span>
        </span>
        <ChevronDownIcon
          className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="mt-3">
          <TrackList tracks={tracks} {...listProps} />
        </div>
      )}
    </section>
  )
}

function NewPlaylistField({ onCreated }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const playlist = await api.createPlaylist(name.trim())
      await reloadPlaylists()
      onCreated(playlist.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const submitOnEnter = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (name.trim() && !busy) create()
  }

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input
          autoFocus
          placeholder="Nom de la playlist"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={submitOnEnter}
        />
        <Button type="button" variant="outline" disabled={busy || !name.trim()} onClick={create}>
          Créer
        </Button>
      </div>
      {error && <p className="text-destructive text-sm break-words">{error}</p>}
    </div>
  )
}

function MoveDialog({ tracks, navidromePlaylist, initialPlaylistId, onClose, onMoved, onDone }) {
  const playlists = usePlaylists(true)
  const [remaining, setRemaining] = useState(tracks)
  const [playlistId, setPlaylistId] = useState(initialPlaylistId)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const weeklyName = navidromePlaylist.toLowerCase()
  const targets = (playlists || []).filter((p) => p.name.toLowerCase() !== weeklyName)
  const selectedId = targets.some((p) => p.id === playlistId) ? playlistId : ''

  const changePlaylist = (value) => {
    setCreating(value === NEW_PLAYLIST)
    if (value !== NEW_PLAYLIST) setPlaylistId(value)
  }

  const selectCreated = (id) => {
    setPlaylistId(id)
    setCreating(false)
  }

  const move = async () => {
    setBusy(true)
    setError(null)
    for (const [index, track] of remaining.entries()) {
      try {
        const updated = await api.moveListenbrainzTrack(track.mbid, selectedId)
        onMoved(updated, selectedId)
      } catch (e) {
        setRemaining(remaining.slice(index))
        setError(e.message)
        setBusy(false)
        return
      }
    }
    onDone()
  }

  const changeOpen = (open) => {
    if (!open && !busy) onClose()
  }

  return (
    <Dialog open onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Déplacer vers une playlist</DialogTitle>
          <DialogDescription>
            {moveDescription(remaining, navidromePlaylist)}
          </DialogDescription>
        </DialogHeader>
        <Select value={creating ? NEW_PLAYLIST : selectedId} onValueChange={changePlaylist}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={playlists ? 'Choisir une playlist' : 'Chargement…'} />
          </SelectTrigger>
          <SelectContent>
            {targets.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="truncate">{p.name}</span>
              </SelectItem>
            ))}
            {targets.length > 0 && <SelectSeparator />}
            <SelectItem value={NEW_PLAYLIST}>Nouvelle playlist…</SelectItem>
          </SelectContent>
        </Select>
        {creating && <NewPlaylistField onCreated={selectCreated} />}
        {error && <p className="text-destructive text-sm break-words">{error}</p>}
        <DialogFooter>
          <Button disabled={busy || creating || !selectedId} onClick={move}>
            Déplacer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlaylistTarget({ navidromePlaylist }) {
  return (
    <p className="text-muted-foreground text-xs">
      {navidromePlaylist
        ? `Playlist Navidrome : ${navidromePlaylist}`
        : 'Playlists m3u dans Playlists/'}
    </p>
  )
}

function Header({ latest, counts, navidromePlaylist, syncing, onSync, retrying, onRetryAll }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold" title={latest?.title}>
          {latest ? latest.title : 'Weekly Exploration'}
        </h2>
        <p className="text-muted-foreground text-sm">
          {latest && `${formatDate(latest.date)} · `}
          {counts.pending} à trier · {counts.kept} gardées · {counts.discarded} supprimées
          {counts.moved > 0 && ` · ${counts.moved} déplacées`}
          {counts.failed > 0 && ` · ${counts.failed} en échec`}
        </p>
        <PlaylistTarget navidromePlaylist={navidromePlaylist} />
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

export default function Weekly({ jobs, navidromePlaylist }) {
  const [playlists, setPlaylists] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [awaitedPlaylist, setAwaitedPlaylist] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [movingTracks, setMovingTracks] = useState(null)
  const [lastMoveTargetId, setLastMoveTargetId] = useState('')
  const [current, setCurrent] = useState(null)
  const [playing, setPlaying] = useState(false)

  const jobRunning = jobs.some(
    (j) => j.kind === 'playlist' && (j.status === 'queued' || j.status === 'downloading'),
  )
  const tracksPending = hasPendingTracks(playlists)
  const selectable = decidableTracks(playlists)
  const selectedTracks = selectable.filter((t) => selected.has(t.mbid))
  const allSelected = selectable.length > 0 && selectedTracks.length === selectable.length

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

  const replaceTrack = (updated) =>
    setPlaylists((current) =>
      current.map((p) => ({
        ...p,
        tracks: p.tracks.map((t) => (t.mbid === updated.mbid ? updated : t)),
      })),
    )

  const closePlayerIfRemoved = (updated) =>
    setCurrent((playingTrack) =>
      playingTrack?.mbid === updated.mbid && (updated.decision === 'discard' || !isPlayable(updated))
        ? null
        : playingTrack,
    )

  const togglePlaying = useCallback(() => setPlaying((p) => !p), [])

  const play = (track) => {
    if (track.mbid === current?.mbid) {
      togglePlaying()
      return
    }
    setCurrent(track)
    setPlaying(true)
  }

  const playNext = () => {
    const next = current && nextPlayable(playlists, current)
    if (next) setCurrent(next)
    else setPlaying(false)
  }

  const applyUpdate = (updated) => {
    replaceTrack(updated)
    closePlayerIfRemoved(updated)
  }

  const toggleSelected = (mbid) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(mbid)) next.delete(mbid)
      else next.add(mbid)
      return next
    })

  const clearSelection = () => setSelected(new Set())

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map((t) => t.mbid)))

  const trackMoved = (updated, playlistId) => {
    applyUpdate(updated)
    setLastMoveTargetId(playlistId)
  }

  const moveDone = () => {
    setMovingTracks(null)
    clearSelection()
  }

  const openMove = navidromePlaylist ? (track) => setMovingTracks([track]) : null
  const openBatchMove = navidromePlaylist ? () => setMovingTracks(selectedTracks) : null

  const discardSelected = async () => {
    setBatchBusy(true)
    setError(null)
    setMessage(null)
    const failures = []
    for (const track of selectedTracks) {
      try {
        applyUpdate(await api.decideListenbrainzTrack(track.mbid, 'discard'))
      } catch (e) {
        failures.push(e.message)
      }
    }
    const discarded = selectedTracks.length - failures.length
    if (discarded > 0) setMessage(`${countLabel(discarded, 'piste', 'supprimée')}.`)
    if (failures.length > 0) {
      setError(`Suppression impossible pour ${countLabel(failures.length, 'piste')} : ${failures[0]}`)
    }
    clearSelection()
    setBatchBusy(false)
  }

  const decide = async (track, decision) => {
    setBusyId(track.mbid)
    setError(null)
    try {
      applyUpdate(await api.decideListenbrainzTrack(track.mbid, decision))
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
  const listProps = {
    busyId,
    batchBusy,
    currentMbid: current?.mbid,
    playing,
    selected,
    onDecide: decide,
    onRetry: retryTrack,
    onMove: openMove,
    onPlay: play,
    onToggleSelect: toggleSelected,
  }

  return (
    <div className={cn(current && 'pb-24')}>
      <Header
        latest={latest}
        counts={countDecisions(playlists || [])}
        navidromePlaylist={navidromePlaylist}
        syncing={syncing}
        onSync={sync}
        retrying={retrying}
        onRetryAll={retryAll}
      />
      {(selectedTracks.length > 0 || batchBusy) && (
        <SelectionBar
          label={
            batchBusy
              ? 'Traitement en cours…'
              : countLabel(selectedTracks.length, 'piste', 'sélectionnée')
          }
          allSelected={allSelected}
          busy={batchBusy}
          onToggleAll={toggleAll}
          onMove={openBatchMove}
          onDiscard={discardSelected}
          onClear={clearSelection}
        />
      )}
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
            tracks={visibleTracks(latest)}
            processing={!latest.processedAt}
            {...listProps}
          />
          {older.map((p) => (
            <OlderPlaylist key={p.mbid} playlist={p} {...listProps} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground py-20 text-center text-sm">
          Aucune playlist pour l’instant. Lancez une synchronisation.
        </p>
      )}
      {movingTracks && (
        <MoveDialog
          tracks={movingTracks}
          navidromePlaylist={navidromePlaylist}
          initialPlaylistId={lastMoveTargetId}
          onClose={() => setMovingTracks(null)}
          onMoved={trackMoved}
          onDone={moveDone}
        />
      )}
      <Player
        track={current}
        playing={playing}
        onTogglePlay={togglePlaying}
        onClose={() => setCurrent(null)}
        onEnded={playNext}
      />
    </div>
  )
}
