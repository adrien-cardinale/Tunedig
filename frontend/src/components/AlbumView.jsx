import { useEffect, useState } from 'react'
import { MusicIcon } from 'lucide-react'
import { getAlbum } from '../api.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import DownloadMenu from './DownloadMenu.jsx'

export default function AlbumView({ browseId, navidrome, onClose, onDownloadAlbum, onDownloadSong }) {
  const [album, setAlbum] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getAlbum(browseId)
      .then((a) => !cancelled && setAlbum(a))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [browseId])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex flex-col sm:max-h-[85dvh] sm:max-w-xl">
        {error && <p className="text-destructive text-sm">{error}</p>}

        {!album && !error && (
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-stretch">
            <Skeleton className="size-28 shrink-0 rounded-lg sm:size-36" />
            <div className="w-full flex-1 space-y-3 py-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-56" />
            </div>
          </div>
        )}

        {album && (
          <>
            <div className="flex shrink-0 flex-col items-center gap-5 sm:flex-row sm:items-stretch">
              {album.thumbnail ? (
                <img
                  className="size-28 shrink-0 rounded-lg object-cover sm:size-36"
                  src={album.thumbnail}
                  alt={album.title}
                />
              ) : (
                <div className="bg-muted text-muted-foreground flex size-28 shrink-0 items-center sm:size-36 justify-center rounded-lg">
                  <MusicIcon className="size-10" />
                </div>
              )}
              <DialogHeader className="w-full min-w-0 justify-center gap-3 sm:flex-1">
                <DialogTitle className="leading-snug">{album.title}</DialogTitle>
                <DialogDescription>
                  {album.artist}
                  {album.year && ` · ${album.year}`}
                  {` · ${album.tracks.length} piste${album.tracks.length > 1 ? 's' : ''}`}
                </DialogDescription>
                <DownloadMenu
                  className="w-full sm:w-auto"
                  label="Télécharger l'album"
                  navidrome={navidrome}
                  onDownload={(quality, playlistId) => {
                    onDownloadAlbum(album, quality, playlistId)
                    onClose()
                  }}
                />
              </DialogHeader>
            </div>

            <ol className="-mx-2 min-h-0 flex-1 overflow-y-auto">
              {album.tracks.map((t) => (
                <li
                  key={t.videoId || t.track}
                  className="hover:bg-accent/50 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors"
                >
                  <span className="text-muted-foreground w-5 shrink-0 text-right text-sm tabular-nums">
                    {t.track}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                  {t.duration && (
                    <span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:inline">
                      {t.duration}
                    </span>
                  )}
                  {t.videoId && (
                    <DownloadMenu
                      compact
                      navidrome={navidrome}
                      onDownload={(quality, playlistId) =>
                        onDownloadSong(
                          {
                            videoId: t.videoId,
                            title: t.title,
                            artist: t.artist || album.artist,
                            album: album.title,
                            albumId: album.browseId,
                            thumbnail: album.thumbnail,
                          },
                          quality,
                          playlistId,
                        )
                      }
                    />
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
