import 'dotenv/config';
import process from 'node:process';
import dns from 'node:dns';
import { createClient } from '@supabase/supabase-js';
import { embed, generateText, Output } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

// 1. Corrige a lentidão de conexão do Node.js (undici) no Windows forçando IPv4
dns.setDefaultResultOrder('ipv4first');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const modeloEmbedding = google.textEmbeddingModel('gemini-embedding-001');

// 2. Contrato Zod Blindado contra Alucinação e Perguntas Parciais
const RespostaBlindadaSchema = z.object({
  statusAtendimento: z
    .enum(['ATENDIDO_INTEGRALMENTE', 'ATENDIDO_PARCIALMENTE', 'RECUSADO_SEM_BASE'])
    .describe('Indica se o documento tinha dados para responder tudo, apenas parte ou nada.'),
  respostaAuditada: z
    .string()
    .describe('Resposta estrita apenas para o que consta nas fontes.'),
  topicosSemEvidencia: z
    .array(z.string())
    .describe('Lista de dúvidas do usuário que NÃO constam nos trechos fornecidos.'),
  fontes: z.array(
    z.object({
      paginaReferencia: z.number(),
      citacaoExata: z.string(),
    })
  ),
});

const NOTA_DE_CORTE_SEMANTICA = 0.60;

async function consultarComGuardrails(pergunta: string) {
  console.log('\n============================================================');
  console.log(`PERGUNTA: "${pergunta}"`);
  console.log('============================================================');

  // Passo A: Vetoriza a pergunta
  const { embedding: vetorPergunta } = await embed({
    model: modeloEmbedding,
    value: pergunta,
  });

  // Passo B: Busca no Supabase
  const { data: candidatos, error } = await supabase.rpc('buscar_documentos_hibrido', {
    query_text: pergunta,
    query_embedding: vetorPergunta,
    match_count: 3,
  });

  if (error) throw new Error(`Erro no Supabase: ${error.message}`);

  // Passo C: GUARDRAIL 1 (Filtro de Nota de Corte em Código)
  const chunksAprovados = candidatos.filter(
    (c: any) => c.score_semantico >= NOTA_DE_CORTE_SEMANTICA || c.score_textual > 0.05
  );

  console.log(`Chunks analisados: ${candidatos.length} | Aprovados na nota de corte: ${chunksAprovados.length}`);

  for (const c of candidatos) {
    const passou = chunksAprovados.includes(c) ? 'APROVADO' : 'DESCARTADO (Abaixo do Threshold)';
    console.log(
      `   -> Pág. ${c.pagina} [Semântico: ${(c.score_semantico * 100).toFixed(1)}% | Texto: ${c.score_textual.toFixed(2)}] => ${passou}`
    );
  }

  // SHORT-CIRCUIT: Se nenhum chunk passou na nota de corte, NÃO chamamos o LLM!
  if (chunksAprovados.length === 0) {
    console.log('\n[BLOQUEIO ANTI-ALUCINAÇÃO ATIVADO]');
    console.log('Nenhum trecho atingiu a nota de corte. O LLM não foi chamado (0 tokens gastos).');
    return {
      statusAtendimento: 'RECUSADO_SEM_BASE',
      respostaAuditada:
        'Não encontrei informações nos manuais corporativos para responder a essa solicitação.',
      topicosSemEvidencia: [pergunta],
      fontes: [],
    };
  }

  // Passo D: GUARDRAIL 2 (Chamada rápida ao LLM com IPv4 e sem Thinking lento)
  const contextoSeguro = chunksAprovados
    .map((c: any) => `[Página ${c.pagina}] ${c.conteudo}`)
    .join('\n\n');

  console.log('\nConsultando o auditor gemini-3.8-flash (modo rápido ativado)...');
  console.time('Tempo de resposta do LLM');

  const resultado = await generateText({
    model: google('gemini-3.8-flash'),
    output: Output.object({ schema: RespostaBlindadaSchema }),
    temperature: 0,
    // Desativa o raciocínio oculto longo para respostas estruturadas instantâneas
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    },
    system: `Você é um auditor técnico rigoroso.
Regras absolutas:
1. Responda APENAS o que estiver comprovado nos trechos.
2. Se a pergunta tiver duas partes e apenas uma constar no texto, marque ATENDIDO_PARCIALMENTE e liste o que faltou em topicosSemEvidencia.
3. Jamais invente, deduza ou use conhecimento externo.`,
    prompt: `Trechos Oficiais:\n${contextoSeguro}\n\nPergunta do Colaborador: ${pergunta}`,
  });

  console.timeEnd('Tempo de resposta do LLM');

  console.log('\n=== RETORNO DO AUDITOR ===');
  console.log('Status:', resultado.output.statusAtendimento);
  console.log('Resposta:', resultado.output.respostaAuditada);
  if (resultado.output.topicosSemEvidencia.length > 0) {
    console.log('Tópicos Recusados (Sem Fonte):', resultado.output.topicosSemEvidencia);
  }
  console.log('Fontes Citadas:', resultado.output.fontes.length);
  console.log('Tokens do LLM gastos:', resultado.usage.totalTokens);
}

async function rodarBateriaDeTestes() {
  // TESTE 1: Pergunta "Pegadinha" (Metade existe no banco, metade não existe)
  await consultarComGuardrails(
    'Qual o procedimento para o erro ERR-904-DB e qual o valor do auxílio creche da empresa?'
  );

  // TESTE 2: Pergunta 100% fora do manual (Deve ativar o Short-Circuit e gastar 0 tokens de LLM)
  await consultarComGuardrails(
    'Como faço para cadastrar minha digital na catraca do estacionamento?'
  );
}

rodarBateriaDeTestes().catch(console.error);