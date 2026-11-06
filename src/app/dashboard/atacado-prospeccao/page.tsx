import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { requireTabAccess } from "@/lib/tabs";
import { criarProspectAction, atualizarStatusProspectAction, registrarInteracaoBruceAction, atualizarPresencaDigitalProspectAction } from "./actions";
import { CsvImportPreview } from "./csv-import-preview";
import { ProspeccaoRadarConsole } from "./prospeccao-radar-console";
import { RevisaoCandidatosWeb } from "./revisao-candidatos-web";
import { ProspectFilters } from "./prospect-filters";
import { CoastalProspectingMap } from "./coastal-prospecting-map";
import { ESTADOS_BRASIL } from "@/lib/prospeccao/estados-litoraneos";
import {
  contarPorStatusComercial,
  listarAprovados,
  listarPendentesRevisao,
  listarReprovados,
  listarMunicipiosDisponiveis,
} from "@/lib/metrics/prospeccao-qualificacao";
import { QualificacaoKpis } from "./qualificacao-kpis";
import { QualificacaoFiltros } from "./qualificacao-filtros";
import { ProspectosAprovadosTable } from "./prospectos-aprovados-table";
import { ProspectosPendentesTable } from "./prospectos-pendentes-table";
import { ProspectosReprovadosTable } from "./prospectos-reprovados-table";

const STATUS: Record<string, string> = {
  NOVO: "Novo",
  EM_QUALIFICACAO: "Em qualificação",
  QUALIFICADO: "Qualificado",
  CONTATADO: "Contatado",
  NEGOCIACAO: "Em negociação",
  CONVERTIDO: "Convertido",
  DESCARTADO: "Descartado",
};

export default async function AtacadoProspeccaoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cidade?: string; uf?: string; erro?: string; criado?: string; importacao?: string; novos?: string; duplicados?: string; invalidos?: string; bruce?: string; revisao?: string; cadastro?: string; presenca?: string; qEstado?: string; qMunicipio?: string; qCapital?: string; qClasse?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  requireTabAccess(user, user.role, "atacado-prospeccao");

  const params = await searchParams;
  const status = params.status && Object.hasOwn(STATUS, params.status) ? params.status : undefined;
  const uf = params.uf && /^[A-Z]{2}$/.test(params.uf.toUpperCase()) ? params.uf.toUpperCase() : undefined;
  const cidade = params.cidade?.trim().slice(0, 100) || undefined;
  const cadastroValores = ["ATIVA", "SUSPENSA", "INAPTA", "BAIXADA", "NULA", "NAO_INFORMADA"];
  const cadastro = params.cadastro && cadastroValores.includes(params.cadastro) ? params.cadastro : undefined;
  const where = {
    ...(status ? { status } : {}),
    ...(uf ? { estado: uf } : {}),
    ...(cidade ? { cidade: { contains: cidade, mode: "insensitive" as const } } : {}),
    ...(cadastro ? { situacaoCadastral: cadastro } : {}),
  };
  const prospects = await prisma.atacadoProspect.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 250,
    include: { activities: { orderBy: { createdAt: "desc" }, take: 3 } },
  });

  // Filtros da seção "Qualificação B2B" — params próprios (qEstado/qMunicipio/qCapital/qClasse),
  // nunca reaproveitando uf/cidade/status acima (aquilo filtra o pipeline manual legado).
  const qEstado = params.qEstado && /^[A-Za-z]{2}$/.test(params.qEstado) ? params.qEstado.toUpperCase() : undefined;
  const qMunicipio = params.qMunicipio?.trim().slice(0, 100) || undefined;
  const qCapital: "capital" | "interior" | undefined = params.qCapital === "capital" || params.qCapital === "interior" ? params.qCapital : undefined;
  const qClasse: "ALTA_PRIORIDADE" | "QUALIFICADO" | undefined = params.qClasse === "ALTA_PRIORIDADE" || params.qClasse === "QUALIFICADO" ? params.qClasse : undefined;
  const filtroQualificacao = { estado: qEstado, municipio: qMunicipio, capital: qCapital, classificacao: qClasse };

  const [contagemQualificacao, aprovados, pendentesRevisao, reprovados, municipiosQualificacao] = await Promise.all([
    contarPorStatusComercial(),
    listarAprovados(filtroQualificacao),
    listarPendentesRevisao(filtroQualificacao),
    listarReprovados(filtroQualificacao),
    listarMunicipiosDisponiveis(qEstado),
  ]);

  const [total, novos, emPesquisa, qualificados, contatados, cidades] = await Promise.all([
    prisma.atacadoProspect.count(),
    prisma.atacadoProspect.count({ where: { status: "NOVO" } }),
    prisma.atacadoProspect.count({ where: { status: "EM_QUALIFICACAO" } }),
    prisma.atacadoProspect.count({ where: { status: "QUALIFICADO" } }),
    prisma.atacadoProspect.count({ where: { status: "CONTATADO" } }),
    prisma.atacadoProspect.findMany({ where: { estado: uf ?? "RJ" }, distinct: ["cidade"], select: { cidade: true }, orderBy: { cidade: "asc" }, take: 300 }),
  ]);

  const stateCounts = Object.fromEntries(await Promise.all(ESTADOS_BRASIL.filter((state) => state.litoraneo).map(async (state) => [state.uf, await prisma.atacadoProspect.count({ where: { estado: state.uf } })] as const)));

  const erro = params.erro;
  const erroTexto = erro === "nome" ? "Informe o nome da loja."
    : erro === "cnpj" ? "Informe um CNPJ com 14 caracteres válidos."
    : erro === "estado" ? "Informe a UF com duas letras."
    : erro === "url" ? "Use apenas endereços completos iniciados por http:// ou https://."
    : erro === "duplicado" ? "Já existe um prospecto cadastrado com esse CNPJ."
    : erro === "conversao" ? "Conversão só é confirmada após o primeiro pedido aparecer no DAPIC."
    : erro === "status" ? "Status inválido."
    : erro === "nao-encontrado" ? "Prospecto não encontrado."
    : null;

  return (
    <div className="space-y-6">
      {params.bruce === "registrado" && <p role="status" className="rounded-md border border-green-600/40 px-3 py-2 text-sm text-green-700">Interação registrada no histórico do Radar.</p>}
      {params.bruce === "erro" && <p role="alert" className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-600">Não foi possível registrar a interação. Confira os campos e tente novamente.</p>}
      {params.presenca === "salva" && <p role="status" className="rounded-md border border-green-600/40 px-3 py-2 text-sm text-green-700">Presença digital salva no cadastro da loja.</p>}
      {params.presenca === "erro" && <p role="alert" className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-600">Não foi possível salvar. Use URLs completas iniciadas por http:// ou https://.</p>}
      <ProspeccaoRadarConsole total={total} novos={novos} emPesquisa={emPesquisa} qualificados={qualificados} contatados={contatados} />

      <section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <div>
          <h2 className="text-sm font-semibold">Qualificação B2B (motor automático)</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Resultado do gate de elegibilidade e pontuação — só quem passa aqui entra na base comercial definitiva. Hoje a maior parte da carteira ainda está EM_INVESTIGACAO: o motor acabou de ser religado e ainda não rodou sobre a base nacional.</p>
        </div>
        <QualificacaoKpis contagem={contagemQualificacao} />
        <QualificacaoFiltros
          estado={qEstado ?? ""}
          municipio={qMunicipio ?? ""}
          capital={qCapital ?? ""}
          classificacao={qClasse ?? ""}
          municipios={municipiosQualificacao}
        />
        <ProspectosAprovadosTable prospects={aprovados} />
        <ProspectosPendentesTable prospects={pendentesRevisao} />
        <details data-testid="qualificacao-reprovados" className="rounded-lg border border-[var(--border)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--text-secondary)]">Auditoria de reprovações ({reprovados.length})</summary>
          <ProspectosReprovadosTable prospects={reprovados} />
        </details>
      </section>

      <CoastalProspectingMap selectedUf={uf ?? ""} selectedCity={cidade ?? ""} cities={cidades.map((item) => item.cidade).filter((value): value is string => Boolean(value))} stateCounts={stateCounts} />
      {params.revisao === "concluida" && <p role="status" className="border border-green-600/40 px-3 py-2 text-sm text-green-700">Revisão concluída: {params.novos ?? "0"} candidatos incluídos na fila de qualificação; {params.duplicados ?? "0"} duplicados ignorados.</p>}
      {params.revisao === "dados-invalidos" && <p role="alert" className="border border-red-500/40 px-3 py-2 text-sm text-red-600">Revise nome, CNPJ com dígitos verificadores, cidade e UF de cada candidato selecionado.</p>}
      {params.revisao === "evidencia-invalida" && <p role="alert" className="border border-red-500/40 px-3 py-2 text-sm text-red-600">Um ou mais candidatos não possuem URL ou evidências comerciais mínimas válidas.</p>}
      {params.revisao === "arquivo-invalido" && <p role="alert" className="border border-red-500/40 px-3 py-2 text-sm text-red-600">Arquivo de revisão inválido. Exporte novamente o CSV do agente de descoberta.</p>}
      <RevisaoCandidatosWeb defaultUf={uf ?? "RJ"} />

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <h2 className="mb-3 text-sm font-semibold">Cadastrar prospecto</h2>
        {erroTexto && <p role="alert" className="mb-3 rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-600">{erroTexto}</p>}
        {params.criado && <p className="mb-3 rounded-md border border-green-600/40 px-3 py-2 text-sm text-green-700">Prospecto cadastrado.</p>}
        <form action={criarProspectAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-[var(--text-secondary)]">Nome da loja *
            <input required name="nomeFantasia" maxLength={160} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Razão social
            <input name="razaoSocial" maxLength={180} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">CNPJ
            <input name="cnpj" inputMode="numeric" maxLength={18} placeholder="00.000.000/0000-00" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Cidade
            <input name="cidade" maxLength={100} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">UF
            <input name="estado" maxLength={2} placeholder="RJ" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm uppercase text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Telefone comercial
            <input name="telefone" maxLength={40} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">E-mail comercial
            <input name="email" type="email" maxLength={180} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Site oficial
            <input name="site" type="url" maxLength={500} placeholder="https://www.loja.com.br" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Instagram da loja
            <input name="instagram" type="url" maxLength={500} placeholder="https://www.instagram.com/sualoja/" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Link da evidência / origem
            <input name="evidenciaUrl" type="url" maxLength={1000} placeholder="https://" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <label className="text-xs text-[var(--text-secondary)]">Origem
            <select name="origem" className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]">
              <option value="manual">Cadastro manual</option>
              <option value="indicacao">Indicação</option>
              <option value="pesquisa_web">Pesquisa na web</option>
              <option value="feira_evento">Feira / evento</option>
              <option value="importacao">Importação</option>
            </select>
          </label>
          <label className="text-xs text-[var(--text-secondary)] sm:col-span-2 lg:col-span-3">Observações
            <textarea name="observacoes" rows={2} maxLength={3000} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]" />
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <button type="submit" className="rounded-md bg-[var(--series-1)] px-4 py-2 text-sm font-medium text-white">Salvar prospecto</button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Importar lista de lojas (CSV)</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Até 500 linhas e 900 KB. Colunas aceitas: nome_fantasia (obrigatória), razao_social, cnpj, cidade, uf, telefone, email, site, instagram e evidencia_url.</p>
          </div>
          <a href="/exemplos/modelo-prospeccao-atacado.csv" className="text-xs underline text-[var(--text-secondary)]">Baixar modelo CSV</a>
        </div>
        {params.importacao === "concluida" && <p role="status" className="mt-3 text-sm text-[var(--text-secondary)]">Importação concluída: {params.novos ?? "0"} novos, {params.duplicados ?? "0"} duplicados ignorados e {params.invalidos ?? "0"} linhas inválidas.</p>}
        {params.importacao && params.importacao !== "concluida" && <p role="alert" className="mt-3 text-sm text-red-600">Não foi possível importar. Verifique o arquivo, o cabeçalho e o limite de tamanho/linhas.</p>}
        <CsvImportPreview />
      </section>
      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Carteira de prospectos ({prospects.length}{total > 250 ? " de " + total : ""})</h2>
          <ProspectFilters
            uf={uf ?? ""}
            cidade={cidade ?? ""}
            status={status ?? ""}
            cadastro={cadastro ?? ""}
            statusOptions={Object.entries(STATUS)}
            cadastroOptions={cadastroValores}
            cidades={cidades.map((item) => item.cidade).filter((value): value is string => Boolean(value))}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Loja</th>
                <th className="px-4 py-3 font-medium">Presença digital</th>
                <th className="px-4 py-3 font-medium">Localização</th>
                <th className="px-4 py-3 font-medium">Aderência</th>
                <th className="px-4 py-3 font-medium">Contato</th>
                <th className="px-4 py-3 font-medium">Origem</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => (
                <tr key={p.id} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.nomeFantasia === "NOME COMERCIAL NÃO IDENTIFICADO" ? "Nome comercial a pesquisar" : p.nomeFantasia}</div>
                    {p.razaoSocial && <div className="mt-0.5 text-xs text-[var(--text-muted)]">Razão social: {p.razaoSocial}</div>}
                    {p.cnpj && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.cnpj}</div>}
                    {p.situacaoCadastral && <div className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${p.situacaoCadastral === "ATIVA" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>Receita: {p.situacaoCadastral}</div>}
                    {p.situacaoCadastral && <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-[var(--text-secondary)] underline">Dados cadastrais oficiais</summary>
                      <div className="mt-1 space-y-0.5 text-[10px] text-[var(--text-muted)]">
                        <div>CNAE principal: {[p.cnaePrincipalCodigo, p.cnaePrincipalDescricao].filter(Boolean).join(" · ") || "Não informado"}</div>
                        {p.cnaesSecundarios && <div>CNAEs secundários: {p.cnaesSecundarios.split("\n").join("; ")}</div>}
                        <div>Endereço: {[p.enderecoOficial, p.cidade, p.estado, p.cepOficial].filter(Boolean).join(" · ") || "Não informado"}</div>
                        <div>Porte: {p.porteEmpresa ?? "Não informado"}</div>
                        <div>Data de abertura: {p.dataAbertura?.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) ?? "Não informada"}</div>
                        <div>Consulta: {p.pesquisadoEm?.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) ?? "Não informada"}</div>
                      </div>
                    </details>}
                    {p.evidenciaUrl && <a href={p.evidenciaUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs underline text-[var(--text-secondary)]">Ver evidência</a>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="flex flex-col items-start gap-1.5">
                      {p.site && /^https?:\/\//i.test(p.site)
                        ? <a href={p.site} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--series-1)] underline underline-offset-2">Abrir site ↗</a>
                        : <a href={`https://www.google.com/search?q=${encodeURIComponent(`${p.nomeFantasia} ${p.cidade ?? ""} ${p.estado ?? ""} site oficial`)}`} target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] underline underline-offset-2">Pesquisar site ↗</a>}
                      {p.instagram && /^https?:\/\//i.test(p.instagram)
                        ? <a href={p.instagram} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--series-1)] underline underline-offset-2">Abrir Instagram ↗</a>
                        : <a href={`https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com ${p.nomeFantasia} ${p.cidade ?? ""} ${p.estado ?? ""}`)}`} target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] underline underline-offset-2">Pesquisar Instagram ↗</a>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                    {p.enderecoOficial && <div className="max-w-64 font-medium text-[var(--text-primary)]">{p.enderecoOficial}</div>}
                    <div className={p.enderecoOficial ? "mt-1" : ""}>{[p.cidade, p.estado].filter(Boolean).join(" / ") || "Cidade não identificada"}</div>
                    {p.cepOficial && <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">CEP {p.cepOficial}</div>}
                    {!p.enderecoOficial && <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">Rua ainda não consultada na Receita</div>}
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.nomeFantasia} ${p.cidade ?? ""} ${p.estado ?? ""}`)}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[10px] text-[var(--series-1)] underline underline-offset-2">Buscar endereço no mapa ↗</a>
                  </td>
                  <td className="px-4 py-3">
                    {/* Estado real do motor (statusComercial), nunca mais grupoComercial A/B/C/D —
                        esse campo não é gravado com A/B/C/D em nenhum fluxo de produção, só
                        "PENDENTE" (ver auditoria). EM_INVESTIGACAO cobre dois momentos distintos;
                        resultadoEliminacao (já existente no schema) é o que diferencia os dois sem
                        precisar de um status novo — ver comentário em prospeccao-qualificacao.ts. */}
                    <div className="mb-1 font-semibold">
                      {p.statusComercial === "APROVADO" && "Aprovado manualmente"}
                      {p.statusComercial === "PENDENTE_REVISAO_HUMANA" && "Pendente de revisão humana"}
                      {p.statusComercial === "REPROVADO" && "Reprovado"}
                      {p.statusComercial === "EM_INVESTIGACAO" && (p.resultadoEliminacao === "INCONCLUSIVO" ? "Em investigação (evidência insuficiente)" : "Aguardando investigação")}
                    </div>
                    {p.scoreComercial !== null && <div className="text-[11px] text-[var(--text-muted)]">{p.justificativaGrupo?.startsWith("EVIDÊNCIA COMERCIAL") ? "Evidência comercial" : "Score cadastral"} {p.scoreComercial}/100{p.justificativaGrupo?.startsWith("EVIDÊNCIA COMERCIAL") ? " · não é aprovação" : ""}</div>}
                    {p.justificativaGrupo && <div className="mt-1 max-w-48 text-[11px] text-[var(--text-muted)]">{p.justificativaGrupo}</div>}
                    {p.responsavel && <div className="mt-1 text-[11px] font-medium text-[var(--series-1)]">Fila: {p.responsavel.replaceAll("_", " ")}</div>}
                    {p.confiancaPesquisa === "CADASTRAL_OFICIAL" && <div className="mt-0.5 text-[10px] font-semibold text-emerald-700">Receita Federal consultada via Serpro · perfil comercial ainda não verificado</div>}{p.confiancaPesquisa === "CADASTRAL" && <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">Triagem cadastral; perfil comercial ainda não verificado</div>}
                    {p.statusComercial !== "EM_INVESTIGACAO" && (
                      <div className="mt-1 text-[11px]">
                        {p.statusComercial === "APROVADO" && <span className="font-semibold text-emerald-700">Aprovado pelo motor — ver seção Qualificação acima</span>}
                        {p.statusComercial === "PENDENTE_REVISAO_HUMANA" && <span className="font-semibold text-amber-700">Pendente de revisão — ver seção Qualificação acima</span>}
                        {p.statusComercial === "REPROVADO" && <span className="font-semibold text-red-600">Reprovado pelo motor — ver auditoria na seção Qualificação</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                    {p.telefone && <div>{p.telefone}</div>}
                    {p.email && <div className="mt-1 break-all">{p.email}</div>}
                    {!p.telefone && !p.email && "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{p.origem.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3">
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-[var(--text-secondary)] underline">Histórico recente ({p.activities.length})</summary>
                      <div className="mt-2 space-y-2">
                        {p.activities.map((activity) => <div key={activity.id} className="rounded border border-[var(--border)] p-2 text-[11px]">
                          <div className="font-medium">{activity.tipo.replaceAll("_", " ")}{activity.resultado ? ` · ${activity.resultado.replaceAll("_", " ")}` : ""}</div>
                          <div className="mt-0.5 text-[var(--text-secondary)]">{activity.descricao}</div>
                          <div className="mt-0.5 text-[var(--text-muted)]">{activity.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
                        </div>)}
                      </div>
                    </details>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] font-medium text-[var(--series-1)] underline">Bruce · Registrar interação</summary>
                      <div className="mt-2 min-w-48 space-y-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Acesso rápido da loja</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <a
                            href={p.site && /^https?:\/\//i.test(p.site) ? p.site : `https://www.google.com/search?q=${encodeURIComponent(`${p.nomeFantasia} ${p.cidade ?? ""} ${p.estado ?? ""} site oficial`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-md border border-[var(--border)] px-2 py-2 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--series-1)]"
                          >{p.site && /^https?:\/\//i.test(p.site) ? "Abrir site ↗" : "Buscar site ↗"}</a>
                          <a
                            href={p.instagram && /^https?:\/\//i.test(p.instagram) ? p.instagram : `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com ${p.nomeFantasia} ${p.cidade ?? ""} ${p.estado ?? ""}`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-md border border-[var(--border)] px-2 py-2 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--series-1)]"
                          >{p.instagram && /^https?:\/\//i.test(p.instagram) ? "Abrir Instagram ↗" : "Buscar Instagram ↗"}</a>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)]">Os links abrem em nova aba. Se ainda não houver endereço cadastrado, o Radar abre uma pesquisa para localizar o perfil ou site correto.</p>
                        <form action={atualizarPresencaDigitalProspectAction} className="space-y-1.5 rounded-md border border-[var(--border)] p-2">
                          <input type="hidden" name="prospectId" value={p.id} />
                          <label className="block text-[10px] text-[var(--text-secondary)]">Salvar site oficial
                            <input name="site" type="url" maxLength={500} defaultValue={p.site ?? ""} placeholder="https://www.loja.com.br" className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-[11px]" />
                          </label>
                          <label className="block text-[10px] text-[var(--text-secondary)]">Salvar Instagram
                            <input name="instagram" type="url" maxLength={500} defaultValue={p.instagram ?? ""} placeholder="https://www.instagram.com/loja/" className="mt-0.5 w-full rounded border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-[11px]" />
                          </label>
                          <button type="submit" className="w-full rounded border border-[var(--series-1)] px-2 py-1.5 text-[11px] font-medium">Salvar links no cadastro</button>
                        </form>
                      </div>
                      <form action={registrarInteracaoBruceAction} className="mt-2 min-w-48 space-y-2">
                        <input type="hidden" name="prospectId" value={p.id} />
                        <textarea name="descricao" required maxLength={1200} rows={2} placeholder="O que aconteceu na conversa?" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" />
                        <select name="resultado" defaultValue="" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs">
                          <option value="">Resultado (opcional)</option>
                          {["INTERESSADO","SEM_RESPOSTA","RECUSOU","PEDIU_CATALOGO","PEDIU_PRECO","NEGOCIANDO","PEDIDO_REALIZADO","RECOMPRA","SEM_ADERENCIA","DADOS_INVALIDOS","OUTRO"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                        </select>
                        <select name="canal" defaultValue="" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs">
                          <option value="">Canal (opcional)</option>
                          {["TELEFONE","EMAIL","INSTAGRAM","WHATSAPP","PRESENCIAL","OUTRO"].map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <input name="etapa" maxLength={80} placeholder="Etapa (opcional)" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs" />
                        <select name="status" defaultValue="" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs">
                          <option value="">Manter status atual</option>
                          {Object.entries(STATUS).filter(([key]) => key !== "CONVERTIDO").map(([key,label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                        <button type="submit" className="w-full rounded-md border border-[var(--series-1)] px-2 py-1.5 text-xs font-medium">Salvar no Radar</button>
                      </form>
                    </details>
                    <form action={atualizarStatusProspectAction} className="mt-2 flex min-w-44 items-center gap-1">
                      <input type="hidden" name="prospectId" value={p.id} />
                      <select name="status" defaultValue={p.status} aria-label="Status do prospecto" className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1 text-xs">
                        {Object.entries(STATUS).filter(([key]) => key !== "CONVERTIDO").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                      <button type="submit" className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">Salvar</button>
                    </form>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--text-muted)]">{p.updatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                </tr>
              ))}
              {prospects.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">Nenhum prospecto cadastrado. Comece adicionando uma loja ou importe uma base numa próxima etapa.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
