import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export default function TooltipButton({ label, className, ...props }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} className={cn('touch-target', className)} {...props} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
