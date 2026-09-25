import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderIcon, MoonIcon, Music2Icon, SearchIcon, SunIcon } from 'lucide-react'
import * as api from './api.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AlbumView from './components/AlbumView.jsx'
import Downloads from './components/Downloads.jsx'
import Results from './components/Results.jsx'
import SongView from './components/SongView.jsx'
import Weekly from './components/Weekly.jsx'

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('tunedig-theme', next ? 'dark' : 'light')
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} title="Basculer le thème">
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

export default function App() {
  const [query, setQuery] = useState('')
  const [type, setType] = useState('songs')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [openAlbum, setOpenAlbum] = useState(null)
  const [openSong, setOpenSong] = useState(null)
  const [jobs, setJobs] = useState([])
  const [musicDir, setMusicDir] = useState('')
  const [navidrome, setNavidrome] = useState(false)
  const [listenbrainz, setListenbrainz] = useState(false)
  const [listenbrainzPlaylist, setListenbrainzPlaylist] = useState(null)
  const lastSearch = useRef('')
  const lastSearchType = useRef(null)

  useEffect(() => {
    api
      .getConfig()
      .then((c) => {
        setMusicDir(c.musicDir)
        setNavidrome(c.navidrome)
        setListenbrainz(c.listenbrainz)
        setListenbrainzPlaylist(c.listenbrainzPlaylist)
      })
      .catch(() => {})
  }, [])

  // Rafraîchit la liste des téléchargements tant qu'un job est actif
  useEffect(() => {
    const poll = () => api.getJobs().then(setJobs).catch(() => {})
    poll()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') poll()
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const runSearch = useCallback(async (q, t) => {
    if (!q.trim()) return
    lastSearch.current = q
    lastSearchType.current = t
    setLoading(true)
    setError(null)
    try {
      setResults(await api.search(q, t))
    } catch (e) {
      setError(`Recherche impossible : ${e.message}`)
      setResults(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const onSubmit = (e) => {
    e.preventDefault()
    const searchType = type === 'weekly' ? 'songs' : type
    setType(searchType)
    runSearch(query, searchType)
  }

  const switchType = (t) => {
    setType(t)
    if (t !== 'weekly' && lastSearch.current && t !== lastSearchType.current) {
      runSearch(lastSearch.current, t)
    }
  }

  const startSong = async (song, quality, playlistId) => {
    try {
      await api.downloadSong({ ...song, quality, playlistId })
    } catch (e) {
      setError(`Téléchargement impossible : ${e.message}`)
    }
  }

  const startAlbum = async (album, quality, playlistId) => {
    try {
      await api.downloadAlbum(album.browseId, quality, playlistId)
    } catch (e) {
      setError(`Téléchargement impossible : ${e.message}`)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <main className="min-w-0 flex-1 px-4 pt-6 pb-24 sm:px-5 lg:px-12 lg:py-10">
        <div className="mx-auto max-w-3xl">
          <header>
            <div className="flex items-start justify-between">
              <h1 className="flex items-center gap-2.5 text-3xl font-extrabold tracking-tight">
                <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl">
                  <Music2Icon className="size-5" />
                </span>
                Tunedig
              </h1>
              <ThemeToggle />
            </div>
            <p className="text-muted-foreground mt-2 flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
              Recherchez, téléchargez, taguez — prêt pour Navidrome
              {musicDir && (
                <span className="text-muted-foreground/70 flex max-w-full min-w-0 items-center gap-1 font-mono text-xs">
                  <FolderIcon className="size-3 shrink-0" />
                  <span className="truncate" title={musicDir}>
                    {musicDir}
                  </span>
                </span>
              )}
            </p>
          </header>

          <form className="mt-5 flex gap-2 sm:mt-7" onSubmit={onSubmit}>
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 hidden size-4 -translate-y-1/2 sm:block" />
              <Input
                className="h-10 sm:pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Artiste, titre, album…"
                autoFocus={window.matchMedia('(hover: hover)').matches}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              className="size-10 sm:w-auto sm:px-6"
              aria-label="Rechercher"
              disabled={loading || !query.trim()}
            >
              <SearchIcon className="sm:hidden" />
              <span className="hidden sm:inline">Rechercher</span>
            </Button>
          </form>

          <Tabs value={type} onValueChange={switchType} className="mt-4 mb-6">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="songs" className="flex-1 px-6">
                Titres
              </TabsTrigger>
              <TabsTrigger value="albums" className="flex-1 px-6">
                Albums
              </TabsTrigger>
              {listenbrainz && (
                <TabsTrigger value="weekly" className="flex-1 px-6">
                  Découverte
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>

          {error && (
            <div
              className="border-destructive/50 bg-destructive/10 text-destructive mb-5 cursor-pointer rounded-lg border px-4 py-3 text-sm"
              onClick={() => setError(null)}
              title="Cliquer pour fermer"
            >
              {error}
            </div>
          )}

          {type === 'weekly' ? (
            <Weekly jobs={jobs} navidromePlaylist={listenbrainzPlaylist} />
          ) : (
            <Results
              results={results}
              type={type}
              loading={loading}
              onOpenSong={setOpenSong}
              onOpenAlbum={setOpenAlbum}
            />
          )}
        </div>
      </main>

      <Downloads jobs={jobs} navidrome={navidrome} />

      {openSong && (
        <SongView
          song={openSong}
          navidrome={navidrome}
          onClose={() => setOpenSong(null)}
          onDownloadSong={startSong}
        />
      )}

      {openAlbum && (
        <AlbumView
          browseId={openAlbum}
          navidrome={navidrome}
          onClose={() => setOpenAlbum(null)}
          onDownloadAlbum={startAlbum}
          onDownloadSong={startSong}
        />
      )}
    </div>
  )
}
