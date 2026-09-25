import { ListPlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function SelectionBar({ label, allSelected, busy, onToggleAll, onMove, onDiscard, onClear }) {
  return (
    <div className="bg-background/95 sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border p-3 backdrop-blur">
      <p className="mr-auto text-sm font-medium">{label}</p>
      <Button variant="outline" size="sm" disabled={busy} onClick={onToggleAll}>
        {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
      </Button>
      {onMove && (
        <Button variant="outline" size="sm" disabled={busy} onClick={onMove}>
          <ListPlusIcon />
          Déplacer…
        </Button>
      )}
      <Button variant="destructive" size="sm" disabled={busy} onClick={onDiscard}>
        <Trash2Icon />
        Supprimer
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
        <XIcon />
        Annuler
      </Button>
    </div>
  )
}
