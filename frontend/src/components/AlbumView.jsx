import { useEffect, useState } from 'react'
import { getAlbum } from '../api.js'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import CoverArt from './CoverArt.jsx'
import DownloadMenu from './DownloadMenu.jsx'
import ErrorAlert from './ErrorAlert.jsx'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './ResponsiveDialog.jsx'

function AlbumSkeleton() {
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-stretch">
      <Skeleton className="size-28 shrink-0 rounded-lg sm:size-36" />
      <div className="w-full flex-1 space-y-3 py-2">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-8 w-56" />
      </div>
    </div>
  )
}

function TrackItem({ track, album, navidrome, onDownloadSong }) {
  return (
    <Item role="listitem" size="sm" className="hover:bg-accent/50 flex-nowrap gap-3 px-2 py-1.5">
      <span className="text-muted-foreground w-5 shrink-0 text-right text-sm tabular-nums">
        {track.track}
      </span>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-1 w-full font-normal">{track.title}</ItemTitle>
      </ItemContent>
      {track.duration && (
        <span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:inline">
          {track.duration}
        </span>
      )}
      {track.videoId && (
        <ItemActions>
          <DownloadMenu
            compact
            navidrome={navidrome}
            onDownload={(quality, playlistId) =>
              onDownloadSong(
                {
                  videoId: track.videoId,
                  title: track.title,
                  artist: track.artist || album.artist,
                  album: album.title,
                  albumId: album.browseId,
                  thumbnail: album.thumbnail,
                },
                quality,
                playlistId,
              )
            }
          />
        </ItemActions>
      )}
    </Item>
  )
}

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
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent className="flex flex-col sm:max-h-[85dvh] sm:max-w-xl">
        {error && <ErrorAlert>{error}</ErrorAlert>}

        {!album && !error && <AlbumSkeleton />}

        {album && (
          <>
            <div className="flex shrink-0 flex-col items-center gap-5 sm:flex-row sm:items-stretch">
              <CoverArt
                className="size-28 rounded-lg sm:size-36"
                iconClassName="size-10"
                src={album.thumbnail}
                alt={album.title}
              />
              <ResponsiveDialogHeader className="w-full min-w-0 justify-center gap-3 sm:flex-1">
                <ResponsiveDialogTitle className="leading-snug">{album.title}</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {album.artist}
                  {album.year && ` · ${album.year}`}
                  {` · ${album.tracks.length} piste${album.tracks.length > 1 ? 's' : ''}`}
                </ResponsiveDialogDescription>
                <DownloadMenu
                  className="w-full sm:w-auto"
                  label="Télécharger l'album"
                  navidrome={navidrome}
                  onDownload={(quality, playlistId) => {
                    onDownloadAlbum(album, quality, playlistId)
                    onClose()
                  }}
                />
              </ResponsiveDialogHeader>
            </div>

            <ItemGroup className="-mx-2 sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
              {album.tracks.map((t) => (
                <TrackItem
                  key={t.videoId || t.track}
                  track={t}
                  album={album}
                  navidrome={navidrome}
                  onDownloadSong={onDownloadSong}
                />
              ))}
            </ItemGroup>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
