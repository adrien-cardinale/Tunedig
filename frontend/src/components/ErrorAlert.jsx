import { CircleAlertIcon, XIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function ErrorAlert({ children, onDismiss, className }) {
  return (
    <Alert variant="destructive" className={cn(onDismiss && 'pr-12', className)}>
      <CircleAlertIcon />
      <AlertDescription className="break-words">{children}</AlertDescription>
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="touch-target absolute top-1.5 right-1.5"
          aria-label="Fermer"
          onClick={onDismiss}
        >
          <XIcon />
        </Button>
      )}
    </Alert>
  )
}
