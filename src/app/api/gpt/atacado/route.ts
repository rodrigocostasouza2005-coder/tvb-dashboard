import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiToken } from "@/lib/api-token";

const STATUS = new Set(["NOVO", "EM_QUALIFICACAO", "QUALIFICADO", "CONTATADO", "NEGOCIACAO", "CONVERTIDO", "DESCARTADO"]);
const RESULTADOS = new Set(["INTERESSADO", "SEM_RESPOSTA", "RECUSOU", "PEDIU_CATALOGO", "PEDIU_PRECO", "NEGOCIANDO", "PEDIDO_REALIZADO", "RECOMPRA", "SEM_ADERENCIA", "DADOS_INVALIDOS", "OUTRO"]);
const CANAIS = new Set(["TELEFONE", "EMAIL", "INSTAGRAM", "WHATSAPP", "PRESENCIAL", "OUTRO"]);

async function autorizado(request: NextRequest) {
  const auth = request.headers.get("authorization");
  return verifyApiToken(auth?.startsWith("Bearer ") ? auth.slice(7) : null);
}

// API restrita para o Bruce e agentes internos: carteira comercial, registro de interações e leitura de padrões.
// Não expõe vendas, clientes existentes, dados pessoais de sócios nem permite abordagem automática.
export async function GET(request: NextRequest) {
  if (!(await autorizado(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const resource = request.nextUrl.searchParams.get("resource") ?? "fila";

  if (resource === "fila") {
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "15");
    const limit = Number.isFinite(limitRaw) ? Math.min(25, Math.max(1, Math.floor(limitRaw))) : 15;
    const prospects = await prisma.atacadoProspect.findMany({
      where: { status: { in: ["QUALIFICADO", "CONTATADO", "NEGOCIACAO"] } },
      orderBy: [{ updatedAt: "asc" }], take: limit,
      select: { id: true, nomeFantasia: true, razaoSocial: true, cidade: true, estado: true, site: true, instagram: true, telefone: true, email: true, grupoComercial: true, scoreComercial: true, justificativaGrupo: true, segmentoComercial: true, perfilLoja: true, faixaPreco: true, status: true, observacoes: true, activities: { orderBy: { createdAt: "desc" }, take: 3, select: { tipo: true, descricao: true, resultado: true, canal: true, etapa: true, createdAt: true } } },
    });
    return NextResponse.json({ resource: "fila", quantidade: prospects.length, prospectos: prospects });
  }

  if (resource === "inteligencia") {
    // Conta os resultados reais por perfil, sem inferir conversão a partir de mera resposta.
    const grouped = await prisma.atacadoProspect.groupBy({
      by: ["segmentoComercial", "perfilLoja", "faixaPreco", "cidade", "estado", "status"],
      _count: { _all: true },
      where: { status: { in: ["CONVERTIDO", "NEGOCIACAO", "CONTATADO", "DESCARTADO"] } },
    });
    const key = (v: {segmentoComercial:string|null;perfilLoja:string|null;faixaPreco:string|null;cidade:string|null;estado:string|null}) => [v.segmentoComercial,v.perfilLoja,v.faixaPreco,v.cidade,v.estado].join("|");
    const totals = new Map<string, {total:number;convertido:number;negociacao:number;descartado:number}>();
    for (const r of grouped) {
      const k=key(r); const v=totals.get(k) ?? {total:0,convertido:0,negociacao:0,descartado:0};
      v.total += r._count._all;
      if (r.status === "CONVERTIDO") v.convertido += r._count._all;
      if (r.status === "NEGOCIACAO") v.negociacao += r._count._all;
      if (r.status === "DESCARTADO") v.descartado += r._count._all;
      totals.set(k,v);
    }
    const recomendacoes = [...totals.entries()].map(([k,v]) => ({perfil:k.split("|"),...v,taxaConversao:v.total ? Math.round(v.convertido/v.total*100) : 0}))
      .filter((v) => v.total >= 3)
      .sort((a,b) => b.taxaConversao-a.taxaConversao || b.convertido-a.convertido).slice(0,10);
    return NextResponse.json({ resource: "inteligencia", amostraMinima: 3, recomendacoes, aviso: "Padrões exploratórios. Só recomendar expansão após amostra mínima; não alterar classificação automaticamente." });
  }
  return NextResponse.json({ error: "Use resource=fila ou resource=inteligencia." }, { status: 400 });
}

export async function POST(request: NextRequest) {
  if (!(await autorizado(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => null) as null | { prospectId?: string; descricao?: string; resultado?: string; canal?: string; status?: string; etapa?: string };
  if (!body?.prospectId || typeof body.descricao !== "string" || !body.descricao.trim() || body.descricao.length > 1200) return NextResponse.json({ error: "prospectId e descricao (até 1200 caracteres) são obrigatórios." }, { status: 400 });
  if (body.resultado && !RESULTADOS.has(body.resultado)) return NextResponse.json({ error: "Resultado inválido." }, { status: 400 });
  if (body.canal && !CANAIS.has(body.canal)) return NextResponse.json({ error: "Canal inválido." }, { status: 400 });
  if (body.status && !STATUS.has(body.status)) return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  const current = await prisma.atacadoProspect.findUnique({ where: { id: body.prospectId }, select: { id: true, status: true } });
  if (!current) return NextResponse.json({ error: "Prospecto não encontrado." }, { status: 404 });
  const nextStatus = body.status ?? current.status;
  await prisma.$transaction([
    prisma.atacadoProspectActivity.create({ data: { prospectId: current.id, tipo: "INTERACAO_BRUCE", descricao: body.descricao.trim(), resultado: body.resultado ?? null, canal: body.canal ?? null, etapa: body.etapa?.slice(0,80) ?? null, criadoPor: "Bruce" } }),
    ...(nextStatus !== current.status ? [prisma.atacadoProspect.update({ where: { id: current.id }, data: { status: nextStatus } })] : []),
  ]);
  return NextResponse.json({ success: true, prospectId: current.id, status: nextStatus });
}
