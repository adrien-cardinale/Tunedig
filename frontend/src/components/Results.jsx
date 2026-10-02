import { ChevronRightIcon, SearchIcon, SearchXIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import CoverArt from './CoverArt.jsx'

function EmptyResults({ icon, children }) {
  return (
    <Empty className="py-20 md:py-20">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export default function Results({ results, type, loading, onOpenSong, onOpenAlbum }) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[86px] rounded-xl" />
        ))}
      </div>
    )
  }
  if (results === null) {
    return (
      <EmptyResults icon={<SearchIcon />}>
        Lancez une recherche pour trouver des titres ou des albums.
      </EmptyResults>
    )
  }
  if (results.length === 0) {
    return <EmptyResults icon={<SearchXIcon />}>Aucun résultat.</EmptyResults>
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {results.map((r) =>
        type === 'songs' ? (
          <ResultCard
            key={r.videoId}
            title={r.title}
            sub={r.artist}
            badge={r.album}
            extra={r.duration}
            thumbnail={r.thumbnail}
            onClick={() => onOpenSong(r)}
          />
        ) : (
          <ResultCard
            key={r.browseId}
            title={r.title}
            sub={r.artist}
            badge={r.type}
            extra={r.year}
            thumbnail={r.thumbnail}
            onClick={() => onOpenAlbum(r.browseId)}
          />
        ),
      )}
    </div>
  )
}

function ResultCard({ title, sub, badge, extra, thumbnail, onClick }) {
  return (
    <Item
      asChild
      variant="outline"
      className="bg-card hover:bg-accent/50 group w-full cursor-pointer flex-nowrap gap-3 rounded-xl p-3 text-left"
    >
      <button type="button" onClick={onClick}>
        <ItemMedia>
          <CoverArt className="size-15" iconClassName="size-6" src={thumbnail} alt={title} />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0">
          <ItemTitle className="line-clamp-1 w-full" title={title}>
            {title}
          </ItemTitle>
          <ItemDescription className="line-clamp-1" title={sub}>
            {sub}
          </ItemDescription>
          <div className="mt-1.5 flex items-center gap-2">
            {badge && (
              <Badge variant="secondary" className="max-w-40 truncate">
                {badge}
              </Badge>
            )}
            {extra && <span className="text-muted-foreground text-xs">{extra}</span>}
          </div>
        </ItemContent>
        <ItemActions>
          <ChevronRightIcon className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
        </ItemActions>
      </button>
    </Item>
  )
}
