import { CheckCircle2, XCircle, X } from "lucide-react";

export function Toast({ kind, title, message, onClose }: { kind: "success" | "error"; title: string; message: string; onClose: () => void }) {
  return <div className={`toast ${kind}`}>{kind === "success" ? <CheckCircle2/> : <XCircle/>}<div><strong>{title}</strong><span>{message}</span></div><button onClick={onClose}><X/></button></div>;
}
