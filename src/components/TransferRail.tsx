import { CircleArrowLeft, CircleArrowRight } from "lucide-react";

export function TransferRail({onAddSelected,onRemoveSelected,addDisabled,removeDisabled,language}:{onAddSelected:()=>void;onRemoveSelected:()=>void;addDisabled:boolean;removeDisabled:boolean;language:"en"|"pl"}) {
  const pl=language==="pl";
  return <aside className="transfer-rail">
    <button type="button" onClick={onAddSelected} disabled={addDisabled} data-tip={pl?"Dodaj zaznaczone":"Add selected"}><CircleArrowRight/></button>
    <button type="button" onClick={onRemoveSelected} disabled={removeDisabled} data-tip={pl?"Usuń zaznaczone":"Remove selected"}><CircleArrowLeft/></button>
  </aside>;
}
