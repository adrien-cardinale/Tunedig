import { MusicIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import DownloadMenu from './DownloadMenu.jsx'

export default function SongView({ song, onClose, onDownloadSong }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-stretch">
          {song.thumbnail ? (
            <img
              className="size-28 shrink-0 rounded-lg object-cover sm:size-32"
              src={song.thumbnail}
              alt={song.title}
            />
          ) : (
            <div className="bg-muted text-muted-foreground flex size-28 shrink-0 items-center sm:size-32 justify-center rounded-lg">
              <MusicIcon className="size-10" />
            </div>
          )}
          <DialogHeader className="w-full min-w-0 justify-center gap-3 sm:w-auto">
            <DialogTitle className="leading-snug">{song.title}</DialogTitle>
            <DialogDescription>
              {song.artist}
              {song.album && ` · ${song.album}`}
              {song.duration && ` · ${song.duration}`}
            </DialogDescription>
            <DownloadMenu
              className="w-full sm:w-auto"
              onDownload={(quality) => {
                onDownloadSong(song, quality)
                onClose()
              }}
            />
          </DialogHeader>
        </div>
      </DialogContent>
    </Dialog>
  )
}
