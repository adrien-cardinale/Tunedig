import CoverArt from './CoverArt.jsx'
import DownloadMenu from './DownloadMenu.jsx'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from './ResponsiveDialog.jsx'

export default function SongView({ song, navidrome, onClose, onDownloadSong }) {
  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-stretch">
          <CoverArt
            className="size-28 rounded-lg sm:size-32"
            iconClassName="size-10"
            src={song.thumbnail}
            alt={song.title}
          />
          <ResponsiveDialogHeader className="w-full min-w-0 justify-center gap-3 sm:flex-1">
            <ResponsiveDialogTitle className="leading-snug">{song.title}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {song.artist}
              {song.album && ` · ${song.album}`}
              {song.duration && ` · ${song.duration}`}
            </ResponsiveDialogDescription>
            <DownloadMenu
              className="w-full sm:w-auto"
              navidrome={navidrome}
              onDownload={(quality, playlistId) => {
                onDownloadSong(song, quality, playlistId)
                onClose()
              }}
            />
          </ResponsiveDialogHeader>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
