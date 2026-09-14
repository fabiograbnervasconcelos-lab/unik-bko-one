"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LeadResult, WhatsAppGroup } from "@/lib/store";
import { isPendingWhatsApp } from "@/lib/message";

function destinationLabel(groups: WhatsAppGroup[]) {
  const names = groups.filter((group) => group.matched).map((group) => group.name);
  if (names.length) return names.join(" · ");
  return "BKO One Urgente · Gerentes One";
}

export function WhatsAppPreview({
  results,
  groups,
  selectedIds,
  onToggle,
  onToggleAll,
  onSend,
  onDiscard,
  sending,
  scanning,
  canSend,
}: {
  results: LeadResult[];
  groups: WhatsAppGroup[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  onSend: () => void;
  onDiscard: () => void;
  sending: boolean;
  scanning: boolean;
  canSend: boolean;
}) {
  const pending = results.filter(isPendingWhatsApp);
  const selectedPending = pending.filter((row) => selectedIds.has(row.id));
  const sent = results.filter((row) => row.notified && row.draftMessage);
  const destination = destinationLabel(groups);

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-900/50 bg-[#0b141a]">
      <div className="flex flex-col gap-3 border-b border-white/10 bg-[#202c33] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Preview do WhatsApp</p>
          <p className="text-xs text-[#d1d7db]">
            {scanning
              ? "Consulta no GED ainda rodando. O envio libera quando terminar."
              : pending.length
                ? `Para: ${destination}`
                : sent.length
                  ? "Fila enviada."
                  : "Quando o GED achar um status, a mensagem aparece aqui para você validar."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pending.length ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                disabled={sending || scanning}
                onClick={() => onToggleAll(selectedPending.length !== pending.length)}
              >
                {selectedPending.length === pending.length ? "Desmarcar todas" : "Marcar todas"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-[#8696a0] hover:bg-white/10 hover:text-white"
                disabled={sending || scanning || !selectedPending.length}
                onClick={onDiscard}
              >
                Não enviar
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-[#00a884] text-[#111b21] hover:bg-[#00a884]/90"
                disabled={!canSend || sending || scanning || !selectedPending.length}
                onClick={onSend}
              >
                {sending
                  ? "Enviando..."
                  : `Validar e enviar (${selectedPending.length})`}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="max-h-[640px] space-y-4 overflow-y-auto bg-[radial-gradient(circle_at_20%_20%,#13241c_0,#0b141a_42%)] p-4">
        {!pending.length && !sent.length ? (
          <p className="rounded-lg bg-black/30 px-3 py-8 text-center text-sm text-[#d1d7db]">
            Nada para enviar. Se o GED não achar status, o WhatsApp fica parado.
          </p>
        ) : null}

        {pending.map((row) => {
          const checked = selectedIds.has(row.id);
          return (
            <article
              key={row.id}
              className={`rounded-xl border p-3 ${
                checked ? "border-[#00a884]/50 bg-black/25" : "border-white/10 bg-black/15 opacity-60"
              }`}
            >
              <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-[#8696a0]">
                <input
                  type="checkbox"
                  className="size-4 accent-[#00a884]"
                  checked={checked}
                  disabled={sending || scanning}
                  onChange={() => onToggle(row.id)}
                />
                <span>
                  Incluir · {row.name} · {row.cpf}
                </span>
                <Badge className="ml-auto bg-[#005c4b] text-white hover:bg-[#005c4b]">
                  {row.gedResult}
                </Badge>
              </label>
              <p className="mb-2 text-[11px] text-[#8696a0]">Para: {destination}</p>
              <div className="ml-auto max-w-[min(100%,420px)] rounded-lg rounded-tr-sm bg-[#005c4b] px-3 py-2 text-[13px] leading-5 text-[#e9edef] shadow-md">
                <pre className="font-sans whitespace-pre-wrap">{row.draftMessage}</pre>
                <p className="mt-1 text-right text-[10px] text-[#8696a0]">prévia · não enviado</p>
              </div>
            </article>
          );
        })}

        {sent.map((row) => (
          <article key={`sent-${row.id}`} className="rounded-xl border border-white/10 bg-black/15 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-[#8696a0]">
              <span>
                Enviado · {row.name} · {row.cpf}
              </span>
              <Badge variant="outline" className="ml-auto border-[#00a884]/40 text-[#00a884]">
                WhatsApp enviado
              </Badge>
            </div>
            <p className="mb-2 text-[11px] text-[#8696a0]">
              Para: {row.notifyTargets.join(" · ") || destination}
            </p>
            <div className="ml-auto max-w-[min(100%,420px)] rounded-lg rounded-tr-sm bg-[#005c4b] px-3 py-2 text-[13px] leading-5 text-[#e9edef] shadow-md">
              <pre className="font-sans whitespace-pre-wrap">{row.draftMessage}</pre>
              <p className="mt-1 text-right text-[10px] text-[#53bdeb]">✓✓ enviado</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
