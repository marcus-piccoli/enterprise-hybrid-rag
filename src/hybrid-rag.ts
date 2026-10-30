import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { embed, embedMany, generateText, Output } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

// 1. Inicializa a conexão com o Supabase
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const modeloEmbedding = google.textEmbeddingModel('gemini-embedding-001');

// 2. Schema Zod para a resposta auditada
const RespostaAuditadaSchema = z.object({
  respostaDireta: z.string(),
  fontes: z.array(
    z.object({
      paginaReferencia: z.number(),
      citacaoExata: z.string(),
    })
  ),
  confianca: z.enum(['ALTA', 'MEDIA', 'BAIXA']),
});

// 3. Documento corporativo com termos técnicos e siglas específicas
const manualBruto = `
[Página 14]
Política de Trabalho Remoto: Todo engenheiro de software em regime remoto tem direito a um reembolso anual de até US$ 1.500 para atualização de hardware ergonômico, incluindo cadeiras, mesas e monitores.

[Página 15]
Segurança de Rede e Infraestrutura: O acesso aos servidores de produção exige autenticação via chave SSH Ed25519 com certificado corporativo renovado obrigatoriamente a cada 90 dias.

[Página 22]
Política de Férias e Recesso: O colaborador pode parcelar suas férias anuais em até 3 períodos, desde que um deles não seja inferior a 14 dias corridos.

[Página 31]
Protocolo de Contingência ERR-904-DB: Em caso de falha de replicação com código ERR-904-DB no cluster primário, o engenheiro de plantão deve acionar o script de failover manual em até 15 minutos.
`;

function fatiarDocumento(texto: string) {
  const blocos = texto
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  let pagina = 1;
  return blocos.map((bloco) => {
    const match = bloco.match(/\[Página\s+(\d+)\]/i);
    if (match) pagina = parseInt(match[1], 10);
    const conteudo = bloco.replace(/\[Página\s+\d+\]\s*/i, '').trim();
    return { pagina, conteudo };
  });
}

// 4. Ingestão inteligente: só gera e grava vetores se o banco estiver vazio
async function garantirBaseNoBanco() {
  const { count, error } = await supabase
    .from('documentos_rag')
    .select('*', { count: 'exact', head: true });

  if (error) throw new Error(`Erro ao consultar Supabase: ${error.message}`);

  if (count && count > 0) {
    console.log(`Banco já possui ${count} chunks indexados. Pulando vetorização!`);
    return;
  }

  console.log('Banco vazio! Fatiando documento e gerando embeddings para salvar no Supabase...');
  const chunks = fatiarDocumento(manualBruto);

  const { embeddings } = await embedMany({
    model: modeloEmbedding,
    values: chunks.map((c) => c.conteudo),
  });

  const linhasParaInserir = chunks.map((chunk, i) => ({
    pagina: chunk.pagina,
    conteudo: chunk.conteudo,
    embedding: embeddings[i],
  }));

  const { error: insertError } = await supabase
    .from('documentos_rag')
    .insert(linhasParaInserir);

  if (insertError) throw new Error(`Erro ao inserir: ${insertError.message}`);
  console.log('Chunks salvos com sucesso no PostgreSQL (pgvector)!\n');
}

async function executarHybridRAG() {
  await garantirBaseNoBanco();

  // Pergunta com código técnico exato ("ERR-904-DB") + pergunta conceitual
  const pergunta =
    'O que devo fazer se aparecer o código ERR-904-DB e qual chave SSH usamos na produção?';
  console.log(`Pergunta: "${pergunta}"\n`);

  // Vetoriza apenas a pergunta
  const { embedding: vetorPergunta } = await embed({
    model: modeloEmbedding,
    value: pergunta,
  });

  // Chama a função SQL de Busca Híbrida (Semântica + Palavra-chave) no Supabase
  const { data: resultados, error } = await supabase.rpc('buscar_documentos_hibrido', {
    query_text: pergunta,
    query_embedding: vetorPergunta,
    match_count: 2,
  });

  if (error) throw new Error(`Erro na RPC Híbrida: ${error.message}`);

  console.log('=== RESULTADOS DA BUSCA HÍBRIDA NO SUPABASE ===');
  for (const r of resultados) {
    console.log(
      `[Híbrido: ${(r.score_hibrido * 100).toFixed(1)}% | Semântico: ${(r.score_semantico * 100).toFixed(1)}% | Texto: ${r.score_textual.toFixed(3)}] Pág. ${r.pagina}`
    );
  }

  const contexto = resultados
    .map((r: any) => `[Página ${r.pagina}] ${r.conteudo}`)
    .join('\n\n');

  console.log('\nGerando resposta final auditada...');
  const resposta = await generateText({
    model: google('gemini-3.8-flash'),
    output: Output.object({ schema: RespostaAuditadaSchema }),
    system:
      'Você é um engenheiro auditor. Responda apenas com base nos trechos recuperados do banco.',
    prompt: `Contexto do Banco:\n${contexto}\n\nPergunta: ${pergunta}`,
  });

  console.log('\n=== RESPOSTA AUDITADA ===');
  console.log('Síntese:', resposta.output.respostaDireta);
  for (const f of resposta.output.fontes) {
    console.log(`  * [Pág. ${f.paginaReferencia}]: "${f.citacaoExata}"`);
  }
}

executarHybridRAG().catch(console.error);