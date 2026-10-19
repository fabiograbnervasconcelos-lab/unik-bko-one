import * as XLSX from "xlsx";
import { newId } from "@/lib/mailing/crypto";
import { resolveMailingPlanLabel } from "@/lib/mailing/plan-map";
import { onlyDigits, onlyPhone, updateLeads, upsertLeadByKey } from "@/lib/mailing/store";
import type { MailingLead } from "@/lib/mailing/types";

const NAME_KEYS = ["nome", "name", "cliente", "razao", "razão", "razaosocial"];
const PHONE_KEYS = [
  "telefone",
  "phone",
  "celular",
  "whatsapp",
  "fone",
  "tel",
  "contato",
];
const DOC_KEYS = ["cpf", "cnpj", "documento", "doc"];
const EMAIL_KEYS = ["email", "e-mail"];
const CITY_KEYS = ["cidade", "city", "municipio", "município"];
const STATE_KEYS = ["uf", "estado", "state"];
const ADDRESS_KEYS = ["endereco", "endereço", "address", "rua"];
const ZIP_KEYS = ["cep", "zip"];
const PLAN_KEYS = ["plano", "plan", "oferta"];
const PLAN_VALUE_KEYS = ["valor", "valorplano", "preco", "preço", "price", "mensalidade"];
const NOTES_KEYS = ["obs", "observacao", "observação", "notes", "nota"];

function normKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function pick(row: Record<string, unknown>, keys: string[]): string {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    map.set(normKey(key), value);
  }
  for (const key of keys) {
    const value = map.get(normKey(key));
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function buildExcelTemplate(): Buffer {
  const rows = [
    {
      nome: "Maria Exemplo",
      telefone: "48999990000",
      cpf: "",
      email: "",
      endereco: "",
      cidade: "",
      uf: "",
      cep: "",
      plano: "",
      observacao: "",
    },
  ];
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Mailing");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function parseExcelBuffer(buffer: Buffer): Array<Record<string, unknown>> {
  const book = XLSX.read(buffer, { type: "buffer" });
  const sheetName = book.SheetNames[0];
  if (!sheetName) return [];
  const sheet = book.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

export async function importExcelLeads(params: {
  buffer: Buffer;
  createdBy: string;
}): Promise<{ imported: number; skipped: number; errors: string[]; leads: MailingLead[] }> {
  const rows = parseExcelBuffer(params.buffer);
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const created: MailingLead[] = [];

  await updateLeads((leads) => {
    let next = leads;
    rows.forEach((row, index) => {
      const name = pick(row, NAME_KEYS);
      const phone = pick(row, PHONE_KEYS);
      if (!name || !onlyPhone(phone)) {
        skipped += 1;
        errors.push(`Linha ${index + 2}: nome e telefone são obrigatórios.`);
        return;
      }
      const rawDoc = pick(row, DOC_KEYS);
      const document = onlyDigits(rawDoc || "") || undefined;
      const draft = {
        id: newId("lead"),
        source: "excel" as const,
        queue: "transferir" as const,
        name,
        phone: onlyPhone(phone),
        document,
        email: pick(row, EMAIL_KEYS) || undefined,
        address: pick(row, ADDRESS_KEYS) || undefined,
        city: pick(row, CITY_KEYS) || undefined,
        state: pick(row, STATE_KEYS) || undefined,
        zip: pick(row, ZIP_KEYS) || undefined,
        plan:
          resolveMailingPlanLabel({
            valorPlano: pick(row, PLAN_VALUE_KEYS),
            plano: pick(row, PLAN_KEYS),
          }) || undefined,
        notes: pick(row, NOTES_KEYS) || undefined,
        raw: row,
        createdBy: params.createdBy,
      };
      const result = upsertLeadByKey(next, draft);
      next = result.leads;
      if (result.created) {
        imported += 1;
        created.push(result.lead);
      } else {
        skipped += 1;
        if (result.skipReason === "cpf") {
          errors.push(`Linha ${index + 2}: CPF ${document} já cadastrado — ignorado.`);
        }
      }
    });
    return next;
  });

  return { imported, skipped, errors, leads: created };
}
