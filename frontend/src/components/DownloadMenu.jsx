import { useEffect, useState, useSyncExternalStore } from 'react'
import { DownloadIcon } from 'lucide-react'
import { createPlaylist, getPlaylists } from '../api.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
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

const OPTIONS = [
  { id: 'best', label: 'Originale' },
  { id: 'mp3-320', label: 'MP3 320' },
  { id: 'mp3-v0', label: 'MP3 V0' },
  { id: 'mp3-192', label: 'MP3 192' },
  { id: 'mp3-128', label: 'MP3 128' },
]

const NO_PLAYLIST = 'none'
const NEW_PLAYLIST = '__new__'

function createStore(initial, storageKey) {
  let value = initial
  const listeners = new Set()
  return {
    get: () => value,
    set: (next) => {
      value = next
      if (storageKey) localStorage.setItem(storageKey, next)
      listeners.forEach((fn) => fn())
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

const useStore = (store) => useSyncExternalStore(store.subscribe, store.get)

export const qualityStore = createStore(
  localStorage.getItem('tunedig-quality') || 'best',
  'tunedig-quality',
)

export const playlistIdStore = createStore(
  localStorage.getItem('tunedig-playlist') || '',
  'tunedig-playlist',
)

export const playlistsStore = createStore(null)

let playlistsRequest = null

export function reloadPlaylists() {
  playlistsRequest = getPlaylists()
    .then((list) => playlistsStore.set(list))
    .catch(() => {
      playlistsRequest = null
    })
  return playlistsRequest
}

export function usePlaylists(enabled) {
  const playlists = useStore(playlistsStore)
  useEffect(() => {
    if (enabled && !playlistsRequest) reloadPlaylists()
  }, [enabled])
  return playlists
}

function useSelectedPlaylist(playlists) {
  const playlistId = useStore(playlistIdStore)
  const selected = playlists?.find((p) => p.id === playlistId) || null
  const stale = playlists !== null && playlistId !== '' && !selected
  useEffect(() => {
    if (stale) playlistIdStore.set('')
  }, [stale])
  return selected
}

function NewPlaylistDialog({ open, onOpenChange }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const changeOpen = (next) => {
    if (!next) {
      setName('')
      setError(null)
    }
    onOpenChange(next)
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const playlist = await createPlaylist(name.trim())
      await reloadPlaylists()
      playlistIdStore.set(playlist.id)
      changeOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Nouvelle playlist</DialogTitle>
            <DialogDescription>Playlist créée dans Navidrome.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Nom de la playlist"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && <p className="text-destructive text-sm break-words">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()}>
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PlaylistSelect({ compact, playlists, selected }) {
  const [creating, setCreating] = useState(false)

  const change = (value) => {
    if (value === NEW_PLAYLIST) setCreating(true)
    else playlistIdStore.set(value === NO_PLAYLIST ? '' : value)
  }

  return (
    <>
      <Select value={selected?.id || NO_PLAYLIST} onValueChange={change}>
        <SelectTrigger
          size="sm"
          className={cn('w-[150px] min-w-0', compact ? 'hidden sm:flex' : 'shrink-0')}
          title="Playlist Navidrome où ajouter les pistes téléchargées"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_PLAYLIST}>Aucune playlist</SelectItem>
          {(playlists || []).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <span className="truncate">{p.name}</span>
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW_PLAYLIST}>Nouvelle playlist…</SelectItem>
        </SelectContent>
      </Select>
      <NewPlaylistDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

export default function DownloadMenu({
  onDownload,
  compact = false,
  navidrome = false,
  label = 'Télécharger',
  className,
}) {
  const q = useStore(qualityStore)
  const playlists = usePlaylists(navidrome)
  const selected = useSelectedPlaylist(navidrome ? playlists : null)
  const playlist = navidrome ? selected : null
  const download = () => onDownload(q, playlist?.id || null)
  const downloadTitle = playlist ? `Télécharger et ajouter à « ${playlist.name} »` : 'Télécharger'

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} onClick={(e) => e.stopPropagation()}>
      <Select value={q} onValueChange={qualityStore.set}>
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
      {navidrome && <PlaylistSelect compact={compact} playlists={playlists} selected={selected} />}
      {compact ? (
        <Button size="icon-sm" variant="secondary" title={downloadTitle} onClick={download}>
          <DownloadIcon />
        </Button>
      ) : (
        <Button className="flex-1 sm:flex-none" title={playlist ? downloadTitle : undefined} onClick={download}>
          <DownloadIcon />
          {label}
        </Button>
      )}
    </div>
  )
}
