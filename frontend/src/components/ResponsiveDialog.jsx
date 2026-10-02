import { createContext, useContext } from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'

const DesktopContext = createContext(true)
const InsideDrawerContext = createContext(false)

const useDesktop = () => useContext(DesktopContext)

function DrawerRoot(props) {
  const nested = useContext(InsideDrawerContext)
  const Root = nested ? DrawerPrimitive.NestedRoot : Drawer
  return (
    <InsideDrawerContext.Provider value>
      <Root {...props} />
    </InsideDrawerContext.Provider>
  )
}

function ResponsiveDialog(props) {
  const desktop = useMediaQuery('(min-width: 40rem)')
  const Root = desktop ? Dialog : DrawerRoot
  return (
    <DesktopContext.Provider value={desktop}>
      <Root {...props} />
    </DesktopContext.Provider>
  )
}

function ResponsiveDialogContent({ className, children }) {
  if (useDesktop()) return <DialogContent className={className}>{children}</DialogContent>
  return (
    <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[90dvh]">
      <div
        className={cn(
          'flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
          className,
        )}
      >
        {children}
      </div>
    </DrawerContent>
  )
}

function ResponsiveDialogHeader({ className, ...props }) {
  if (useDesktop()) return <DialogHeader className={className} {...props} />
  return <DrawerHeader className={cn('p-0', className)} {...props} />
}

function ResponsiveDialogFooter({ className, ...props }) {
  if (useDesktop()) return <DialogFooter className={className} {...props} />
  return <DrawerFooter className={cn('p-0', className)} {...props} />
}

function ResponsiveDialogTitle({ className, ...props }) {
  if (useDesktop()) return <DialogTitle className={className} {...props} />
  return <DrawerTitle className={cn('text-lg leading-snug', className)} {...props} />
}

function ResponsiveDialogDescription(props) {
  if (useDesktop()) return <DialogDescription {...props} />
  return <DrawerDescription {...props} />
}

export {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
}
