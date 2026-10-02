import { MusicIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export default function CoverArt({ src, alt = '', className, iconClassName }) {
  return (
    <Avatar className={cn('rounded-md', className)}>
      {src && <AvatarImage className="object-cover" src={src} alt={alt} />}
      <AvatarFallback className="rounded-[inherit]">
        <MusicIcon className={cn('size-4', iconClassName)} />
      </AvatarFallback>
    </Avatar>
  )
}
