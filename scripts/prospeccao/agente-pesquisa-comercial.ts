#!/usr/bin/env node
/**
 * Pesquisa presença digital de prospects já existentes no Radar.
 * Instagram: apenas localiza URL em buscador; nunca acessa nem coleta conteúdo da Meta.
 * Site: visita somente a página inicial quando robots.txt permite. Dry-run por padrão.
 *
 * Rebuild (Fase 1, PR #51): esta é a única etapa do pipeline com chance real de evidência de
 * marca de terceiro, então é o único lugar que chama o motor de qualificação completo
 * (qualificarProspect, em motor-qualificacao.ts) — ver justificativa detalhada em
 * src/lib/prospeccao/adaptadores-qualificacao.ts. avaliacao-comercial.ts (lógica antiga de
 * score 0-100 misturando eliminação e pontuação num único número) não é mais usada aqui; foi
 * substituída pelo motor novo. statusComercial nunca sai desta etapa como APROVADO — o motor
 * mesmo garante isso (ver motor-qualificacao.ts); só uma pessoa promove manualmente depois.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { isSafePublicHttpsUrl } from "../../src/lib/prospeccao/url-segura";
import { calcularConfiancaPesquisa, extrairEvidenciasSite, extrairResultadosBusca, hostEhRedeSocial, type ResultadoBusca } from "../../src/lib/prospeccao/pesquisa-web";
import { aprenderPerfis, pontuarAderenciaPerfil } from "../../src/lib/prospeccao/aprendizado-comercial";
import { qualificarProspect } from "../../src/lib/prospeccao/motor-qualificacao";
import type { SituacaoCadastral } from "../../src/lib/prospeccao/motor-elegibilidade";
import { validarCnpj } from "../../src/lib/prospeccao/cnpj";
import { ehCapitalEstadual } from "../../src/lib/prospeccao/capitais-estaduais";
import {
  calcularCnpjRaiz,
  construirOperacoesMarcas,
  montarCandidatoPesquisaComercial,
  montarRegistroQualificacao,
} from "../../src/lib/prospeccao/adaptadores-qualificacao";
const prisma=new PrismaClient();
const SITUACOES_CADASTRAIS_VALIDAS = new Set(["ATIVA", "SUSPENSA", "INAPTA", "BAIXADA", "NULA", "DESCONHECIDA", "NAO_INFORMADA"]);
function paraSituacaoCadastral(valor: string | null): SituacaoCadastral | null {
  return valor && SITUACOES_CADASTRAIS_VALIDAS.has(valor) ? (valor as SituacaoCadastral) : null;
}
const UA="TVB-Radar-CommercialResearch/1.0";
const TIMEOUT=12000;
async function getHtml(url:string):Promise<string|null>{try{if(!await isSafePublicHttpsUrl(url))return null;const r=await fetch(url,{headers:{"user-agent":UA,accept:"text/html,application/xhtml+xml"},signal:AbortSignal.timeout(TIMEOUT),redirect:"error"});if(!r.ok)return null;const type=r.headers.get("content-type")??"";if(!type.includes("text/html")&&!type.includes("application/xhtml+xml"))return null;return(await r.text()).slice(0,1500000);}catch{return null;}}
function allowedByRobots(body:string,url:string):boolean{const path=new URL(url).pathname;let applies=false;for(const raw of body.split(/\r?\n/)){const line=raw.replace(/#.*$/,"").trim();const [key,...rest]=line.split(":");if(!key||!rest.length)continue;const value=rest.join(":").trim();if(key.trim().toLowerCase()==="user-agent")applies=value==="*"||value.toLowerCase().includes("tvb-radar");else if(key.trim().toLowerCase()==="disallow"&&applies&&value&&(path===value||path.startsWith(value)))return false;}return true;}
async function mayVisit(url:string):Promise<boolean>{try{if(!await isSafePublicHttpsUrl(url))return false;const u=new URL(url);const robots=await fetch(`${u.protocol}//${u.host}/robots.txt`,{headers:{"user-agent":UA},signal:AbortSignal.timeout(TIMEOUT),redirect:"error"});if(robots.status===404)return true;if(!robots.ok)return false;return allowedByRobots(await robots.text(),url);}catch{return false;}}
async function search(q:string):Promise<ResultadoBusca[]>{const html=await getHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);return html?extrairResultadosBusca(html).slice(0,12):[];}
function matchesStore(result:ResultadoBusca,nome:string):boolean{const norm=(v:string)=>v.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase();const ignored=new Set(["loja","moda","roupa","comercio","ltda","me","epp","de","da","do","e"]);const tokens=norm(nome).split(/[^a-z0-9]+/).filter(x=>x.length>2&&!ignored.has(x));if(!tokens.length)return false;const evidence=norm(`${result.titulo} ${result.trecho} ${new URL(result.url).pathname}`);return tokens.filter(x=>evidence.includes(x)).length/tokens.length>=0.5;}
function siteResult(results:ResultadoBusca[],nome:string){return results.find(x=>!hostEhRedeSocial(x.url)&&matchesStore(x,nome)&&!/google\\.|bing\\.|duckduckgo\\.|maps\\./i.test(new URL(x.url).hostname))??null;}
function instagramResult(results:ResultadoBusca[],nome:string){return results.find(x=>{try{return new URL(x.url).hostname.replace(/^www\\./,"")==="instagram.com"&&matchesStore(x,nome);}catch{return false;}})??null;}
async function research(p:{id:string;nomeFantasia:string;cidade:string|null;estado:string|null;site:string|null;instagram:string|null;observacoes:string|null}){const loc=[p.cidade,p.estado].filter(Boolean).join(" ");const base=`"${p.nomeFantasia}" "${loc}" loja`;const [social,commercial]=await Promise.all([search(`${base} Instagram`),search(`${base} moda masculina multimarcas site oficial`)]);const ig=p.instagram?null:instagramResult(social,p.nomeFantasia);const candidate=p.site?null:siteResult(commercial,p.nomeFantasia);const urlToCheck=p.site??candidate?.url??null;let evidence:ReturnType<typeof extrairEvidenciasSite>|null=null;let site:string|null=null;let confidence:"ALTA"|"MEDIA"|"BAIXA"="BAIXA";if(urlToCheck&&await mayVisit(urlToCheck)){const html=await getHtml(urlToCheck);if(html){evidence=extrairEvidenciasSite(urlToCheck,html);confidence=calcularConfiancaPesquisa({nomeLoja:p.nomeFantasia,cidade:p.cidade,titulo:evidence.titulo,descricao:evidence.descricao,texto:evidence.texto});if(confidence!=="BAIXA")site=urlToCheck;}}return{instagram:p.instagram??ig?.url??null,ig,site,candidate,evidence,confidence,at:new Date()};}
async function main(){const args=process.argv.slice(2);const arg=(k:string,d:string)=>{const i=args.indexOf(k);return i>=0?args[i+1]??d:d;};const apply=args.includes("--apply");const uf=arg("--uf","RJ").toUpperCase();const limit=Math.max(1,Math.min(25,Number(arg("--limit","10"))||10));if(!/^[A-Z]{2}$/.test(uf))throw new Error("UF inválida.");const atividadesAprendizado=await prisma.atacadoProspectActivity.findMany({where:{tipo:"INTERACAO_BRUCE",resultado:{not:null}},orderBy:{createdAt:"desc"},take:5000,select:{prospectId:true,resultado:true,prospect:{select:{segmentoComercial:true,perfilLoja:true,faixaPreco:true,estado:true,status:true}}}});
const perfisAprendidos=aprenderPerfis(atividadesAprendizado.map(a=>({prospectId:a.prospectId,resultado:a.resultado as "INTERESSADO"|"SEM_RESPOSTA"|"RECUSOU"|"PEDIU_CATALOGO"|"PEDIU_PRECO"|"NEGOCIANDO"|"PEDIDO_REALIZADO"|"RECOMPRA"|"SEM_ADERENCIA"|"DADOS_INVALIDOS"|"OUTRO"|null,segmentoComercial:a.prospect.segmentoComercial,perfilLoja:a.prospect.perfilLoja,faixaPreco:a.prospect.faixaPreco,estado:a.prospect.estado,status:a.prospect.status})));
const candidatos=await prisma.atacadoProspect.findMany({where:{estado:uf,status:{in:["NOVO","EM_QUALIFICACAO"]},grupoComercial:"PENDENTE",origem:{in:["receita_federal_dados_abertos","manual","importacao","pesquisa_web"]},AND:[{OR:[{responsavel:null},{responsavel:"AGENTE_PESQUISA_COMERCIAL_WEB_V1"},{responsavel:"AGENTE_QUALIFICACAO_RECEITA_V1"}]},{OR:[{pesquisadoEm:null},{confiancaPesquisa:"BAIXA"},{confiancaPesquisa:"CADASTRAL"}]}]},orderBy:[{pesquisadoEm:"asc"},{updatedAt:"asc"}],take:250,select:{id:true,nomeFantasia:true,cidade:true,estado:true,site:true,instagram:true,observacoes:true,segmentoComercial:true,perfilLoja:true,faixaPreco:true,situacaoCadastral:true,cnpj:true,telefone:true,email:true,confiancaPesquisa:true}});
const prospects=candidatos.map(p=>({p,prioridade:pontuarAderenciaPerfil(p,perfisAprendidos)})).sort((a,b)=>b.prioridade.pontos-a.prioridade.pontos).slice(0,limit).map(x=>({...x.p,prioridadeAprendida:x.prioridade}));
console.log(`PESQUISA COMERCIAL | UF=${uf} | lojas=${prospects.length} | perfis aprendidos=${perfisAprendidos.length} | modo=${apply?"APLICAR":"PRÉVIA"}`);
for (const p of prospects) {
  const r = await research(p);
  const cnpjValido = p.cnpj ? Boolean(validarCnpj(p.cnpj)) : false;
  const hasContato = Boolean(p.telefone?.trim() || p.email?.trim());
  const candidato = montarCandidatoPesquisaComercial({
    nomeFantasia: p.nomeFantasia,
    cnpj: p.cnpj,
    cnpjValido,
    hasContato,
    situacaoCadastral: paraSituacaoCadastral(p.situacaoCadastral),
    confianca: r.confidence,
    siteConfirmado: r.site,
    urlReferencia: r.site ?? r.candidate?.url ?? r.ig?.url ?? null,
    evidencia: r.evidence,
    dataVerificacao: r.at,
    fontesOficiaisConsultadas: p.confiancaPesquisa === "CADASTRAL_OFICIAL",
    instagramEncontrado: Boolean(r.instagram),
    potencialComercialSinais: p.prioridadeAprendida.correspondencias.map((descricao) => ({ descricao })),
  });
  // Única chamada real ao motor de qualificação completo no pipeline (ver cabeçalho do arquivo
  // e adaptadores-qualificacao.ts) — nunca aprova sozinho, sempre PENDENTE_REVISAO_HUMANA/
  // EM_INVESTIGACAO/REPROVADO (motor-qualificacao.ts garante isso).
  const resultado = qualificarProspect(candidato);
  const registro = montarRegistroQualificacao(resultado);
  const operacoesMarcas = construirOperacoesMarcas(candidato.marcas);
  const summary = [
    `Pesquisa web em ${r.at.toISOString()}`,
    `confiança de correspondência: ${r.confidence}`,
    r.site ? `site candidato: ${r.site}` : "site não localizado",
    r.instagram ? `Instagram candidato: ${r.instagram}` : "Instagram não localizado",
    `GATE: ${resultado.eliminacao.resultado} | STATUS: ${resultado.statusComercial}`,
    resultado.motivo,
    operacoesMarcas.length
      ? `marcas de terceiro comprovadas: ${operacoesMarcas.map((m) => m.marca).join(", ")}`
      : "nenhuma marca de terceiro comprovada nesta pesquisa",
    "Instagram não acessado; link é candidato localizado em buscador.",
    "Grupo comercial permanece PENDENTE; statusComercial nunca é gravado como APROVADO automaticamente — promoção é sempre manual.",
  ].join(" | ");
  console.log(`\n${p.nomeFantasia} · ${p.cidade??"cidade não informada"}/${uf}\nprioridade por padrões históricos: ${p.prioridadeAprendida.pontos}/9 (${p.prioridadeAprendida.correspondencias.join(", ")||"sem correspondência"})\n${summary}`);
  if (!apply) continue;
  const notes = [p.observacoes, summary].filter(Boolean).join("\n").slice(0, 8000);
  await prisma.$transaction([
    prisma.atacadoProspect.update({
      where: { id: p.id },
      data: {
        status: registro.status,
        responsavel: "AGENTE_PESQUISA_COMERCIAL_WEB_V1",
        site: r.site ?? undefined,
        instagram: r.instagram,
        evidenciaUrl: r.candidate?.url ?? r.ig?.url ?? undefined,
        evidenciaEm: r.at,
        pesquisadoEm: r.at,
        ultimaValidacaoEm: r.at,
        confiancaPesquisa: r.confidence,
        scoreComercial: registro.scoreComercial,
        justificativaGrupo: registro.justificativaGrupo,
        observacoes: notes,
        grupoComercial: "PENDENTE",
        nomeComercialVerificado: false,
        classificacaoProspect: registro.classificacaoProspect,
        statusComercial: registro.statusComercial,
        resultadoEliminacao: registro.resultadoEliminacao,
        motivosEliminacao: registro.motivosEliminacao,
        scoreDetalhe: registro.scoreDetalhe === null ? Prisma.JsonNull : (registro.scoreDetalhe as Prisma.InputJsonValue),
        evidenciasQualificacao: registro.evidenciasQualificacao as Prisma.InputJsonValue,
        cnpjRaiz: calcularCnpjRaiz(p.cnpj),
        capitalEstadual: ehCapitalEstadual(p.estado ?? "", p.cidade),
      },
    }),
    ...operacoesMarcas.map((op) =>
      prisma.atacadoProspectBrand.upsert({
        where: { prospectId_marcaNormalizada: { prospectId: p.id, marcaNormalizada: op.marcaNormalizada } },
        create: {
          prospectId: p.id, marca: op.marca, marcaNormalizada: op.marcaNormalizada, evidencia: op.evidencia,
          fonteUrl: op.fonteUrl, dataVerificacao: op.dataVerificacao, tipoEvidencia: op.tipoEvidencia, confianca: op.confianca,
        },
        update: {
          marca: op.marca, evidencia: op.evidencia, fonteUrl: op.fonteUrl,
          dataVerificacao: op.dataVerificacao, tipoEvidencia: op.tipoEvidencia, confianca: op.confianca,
        },
      }),
    ),
    prisma.atacadoProspectActivity.create({
      data: { prospectId: p.id, tipo: "PESQUISA_COMERCIAL", etapa: "PRESENCA_DIGITAL", criadoPor: "AGENTE_PESQUISA_COMERCIAL_WEB_V1", descricao: summary.slice(0, 1900) },
    }),
  ]);
}
console.log(apply?"Pesquisa gravada; statusComercial nunca é gravado como APROVADO automaticamente (promoção é sempre manual).":"Prévia concluída: banco não foi alterado. Use --apply para gravar.");}
main().catch(e=>{console.error("Falha na pesquisa comercial:",e instanceof Error?e.message:e);process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();});
