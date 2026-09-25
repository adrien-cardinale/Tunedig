async function request(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail || detail
    } catch {
      /* réponse non-JSON */
    }
    throw new Error(detail)
  }
  return res.json()
}

export const search = (q, type) =>
  request(`/api/search?q=${encodeURIComponent(q)}&type=${type}`)

export const getAlbum = (browseId) =>
  request(`/api/album/${encodeURIComponent(browseId)}`)

export const downloadSong = (song) =>
  request('/api/download/song', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(song),
  })

export const downloadAlbum = (browseId, quality, playlistId) =>
  request('/api/download/album', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ browseId, quality, playlistId }),
  })

export const getPlaylists = () => request('/api/navidrome/playlists')

export const createPlaylist = (name) =>
  request('/api/navidrome/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })

export const getFormats = (videoId) =>
  request(`/api/formats/${encodeURIComponent(videoId)}`)

export const getJobs = () => request('/api/jobs')

export const getConfig = () => request('/api/config')

export const triggerScan = () => request('/api/scan', { method: 'POST' })

export const getListenbrainzTracks = () => request('/api/listenbrainz/tracks')

export const syncListenbrainz = () => request('/api/listenbrainz/sync', { method: 'POST' })

export const decideListenbrainzTrack = (mbid, decision) =>
  request(`/api/listenbrainz/tracks/${encodeURIComponent(mbid)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  })

export const retryListenbrainz = () => request('/api/listenbrainz/retry', { method: 'POST' })

export const retryListenbrainzTrack = (mbid) =>
  request(`/api/listenbrainz/tracks/${encodeURIComponent(mbid)}/retry`, { method: 'POST' })
