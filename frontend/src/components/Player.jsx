import { useEffect, useRef, useState } from 'react'
import { MusicIcon, PauseIcon, PlayIcon, XIcon } from 'lucide-react'
import * as api from '../api.js'
import { Button } from '@/components/ui/button'

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function Cover({ thumbnail }) {
  if (thumbnail) {
    return <img className="size-10 shrink-0 rounded-md object-cover" src={thumbnail} alt="" />
  }
  return (
    <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
      <MusicIcon className="size-4" />
    </div>
  )
}

function SeekBar({ currentTime, duration, onSeek }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs tabular-nums">
      <span>{formatTime(currentTime)}</span>
      <input
        type="range"
        className="accent-primary h-1 min-w-0 flex-1 cursor-pointer"
        min={0}
        max={duration || 0}
        step="any"
        value={currentTime}
        aria-label="Position de lecture"
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <span>{formatTime(duration)}</span>
    </div>
  )
}

export default function Player({ track, playing, onTogglePlay, onClose, onEnded }) {
  const audioRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const path = track?.path

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!playing) {
      audio.pause()
      return
    }
    audio.play().catch((error) => {
      if (error.name === 'NotAllowedError') onTogglePlay()
    })
  }, [path, playing, onTogglePlay])

  if (!track) return null

  const resetTime = () => {
    setCurrentTime(0)
    setDuration(0)
  }

  const seek = (time) => {
    audioRef.current.currentTime = time
    setCurrentTime(time)
  }

  const toggleLabel = playing ? 'Pause' : 'Écouter'

  return (
    <div className="bg-background/95 fixed inset-x-0 bottom-[calc(3.8125rem+env(safe-area-inset-bottom))] z-30 border-t backdrop-blur lg:right-80 lg:bottom-0 lg:pb-[env(safe-area-inset-bottom)]">
      <audio
        ref={audioRef}
        src={api.streamUrl(track.path)}
        preload="auto"
        onLoadStart={resetTime}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={onEnded}
      />
      <div className="mx-auto max-w-3xl space-y-1 px-4 py-2">
        <div className="flex items-center gap-3">
          <Cover thumbnail={track.thumbnail} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={track.title}>
              {track.title}
            </p>
            <p className="text-muted-foreground truncate text-xs" title={track.artist}>
              {track.artist}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            title={toggleLabel}
            aria-label={toggleLabel}
            onClick={onTogglePlay}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title="Fermer le lecteur"
            aria-label="Fermer le lecteur"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        <SeekBar currentTime={currentTime} duration={duration} onSeek={seek} />
      </div>
    </div>
  )
}
