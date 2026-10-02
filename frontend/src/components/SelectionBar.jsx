import { ListPlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'

export default function SelectionBar({ label, allSelected, busy, onToggleAll, onMove, onDiscard, onClear }) {
  return (
    <div className="bg-background/95 sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border p-3 backdrop-blur">
      <p className="mr-auto text-sm font-medium">{label}</p>
      <ButtonGroup className="flex-wrap">
        <ButtonGroup>
          <Button variant="outline" size="sm" className="touch-target" disabled={busy} onClick={onToggleAll}>
            {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
          </Button>
          {onMove && (
            <Button variant="outline" size="sm" className="touch-target" disabled={busy} onClick={onMove}>
              <ListPlusIcon />
              Déplacer…
            </Button>
          )}
        </ButtonGroup>
        <ButtonGroup>
          <Button variant="destructive" size="sm" className="touch-target" disabled={busy} onClick={onDiscard}>
            <Trash2Icon />
            Supprimer
          </Button>
        </ButtonGroup>
        <ButtonGroup>
          <Button variant="ghost" size="sm" className="touch-target" disabled={busy} onClick={onClear}>
            <XIcon />
            Annuler
          </Button>
        </ButtonGroup>
      </ButtonGroup>
    </div>
  )
}
