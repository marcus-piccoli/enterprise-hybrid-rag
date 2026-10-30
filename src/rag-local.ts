import 'dotenv/config';
import { embed, embedMany, cosineSimilarity, generateText, Output } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

// 1. Estrutura de cada pedaço fatiado do documento
interface DocumentoChunk {
  id: string;
  pagina: number;
  conteudo: string;
}

// 2. Evolução do Schema Zod: agora 'fontes' é uma LISTA (z.array)
// Isso permite citar a Página 14 e a Página 15 separadamente sem misturar os textos!
const RespostaMultiCitacaoSchema = z.object({
  respostaDireta: z
    .string()
    .describe('Síntese clara respondendo à dúvida do usuário.'),
  fontes: z
    .array(
      z.object({
        paginaReferencia: z.number().describe('Número da página do trecho utilizado.'),
        citacaoExata: z.string().describe('Trecho literal copiado do documento.'),
      })
    )
    .describe('Lista de todas as evidências usadas para construir a resposta.'),
  confianca: z.enum(['ALTA', 'MEDIA', 'BAIXA']),
});

// 3. Função de Chunking: recebe um texto bruto inteiro e fatia automaticamente por seção/página
function fatiarDocumentoBruto(textoBruto: string): DocumentoChunk[] {
  // Divide o texto toda vez que encontrar uma quebra de linha dupla (parágrafos/seções)
  const blocos = textoBruto
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  let paginaAtual = 1;

  return blocos.map((bloco, index) => {
    // Expressão Regular (Regex) para detectar marcadores como [Página 14]
    const matchPagina = bloco.match(/\[Página\s+(\d+)\]/i);
    if (matchPagina) {
      paginaAtual = parseInt(matchPagina[1], 10);
    }

    // Remove o marcador [Página X] do texto limpo que vai para o vetor
    const conteudoLimpo = bloco.replace(/\[Página\s+\d+\]\s*/i, '').trim();

    return {
      id: `chunk-${index + 1}`,
      pagina: paginaAtual,
      conteudo: conteudoLimpo,
    };
  });
}

// 4. Documento corporativo bruto (simulando a leitura de um PDF/Markdown inteiro)
const manualCorporativoBruto = `
[Página 14]
Política de Trabalho Remoto: Todo engenheiro de software em regime remoto tem direito a um reembolso anual de até US$ 1.500 para atualização de hardware ergonômico, incluindo cadeiras, mesas e monitores.

[Página 15]
Segurança de Rede e Infraestrutura: O acesso aos servidores de produção exige autenticação via chave SSH Ed25519 com certificado corporativo renovado obrigatoriamente a cada 90 dias.

[Página 22]
Política de Férias e Recesso: O colaborador pode parcelar suas férias anuais em até 3 períodos, desde que um deles não seja inferior a 14 dias corridos.

[Página 31]
Despesas de Viagem Corporativa: Alimentação durante viagens presenciais a trabalho é reembolsada até o limite diário de US$ 80 mediante apresentação de nota fiscal.

[Página 45]
Horário Flexível e Reuniões: O horário núcleo de disponibilidade síncrona no Slack é das 10h às 16h (BRT), sendo o restante da jornada assíncrono.
`;

const modeloEmbedding = google.textEmbeddingModel('gemini-embedding-001');

async function executarPipelineRAG() {
  // Passo A: Ingestão e Chunking automático
  const chunks = fatiarDocumentoBruto(manualCorporativoBruto);
  console.log(`1. Documento fatiado automaticamente em ${chunks.length} chunks.`);

  // Passo B: Vetorização da base
  const { embeddings: vetoresBase } = await embedMany({
    model: modeloEmbedding,
    values: chunks.map((c) => c.conteudo),
  });

  // Passo C: Pergunta que exige cruzar informações de 2 setores diferentes
  const pergunta =
    'Quanto posso pedir de reembolso para comprar um monitor e qual é a regra para acessar o servidor de produção?';
  console.log(`\n2. Pergunta recebida: "${pergunta}"`);

  const { embedding: vetorPergunta } = await embed({
    model: modeloEmbedding,
    value: pergunta,
  });

  // Passo D: Busca Semântica + Filtro Top-2 (pegamos APENAS os 2 melhores trechos)
  const topChunks = chunks
    .map((chunk, i) => ({
      ...chunk,
      score: cosineSimilarity(vetorPergunta, vetoresBase[i]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2); // <-- Aqui está o segredo do RAG: descartamos o resto do manual!

  console.log('\n3. Chunks selecionados pelo filtro semântico (Top 2):');
  for (const c of topChunks) {
    console.log(`   - [${(c.score * 100).toFixed(1)}%] Pág. ${c.pagina}: ${c.conteudo}`);
  }

  // Montamos o contexto enxuto contendo apenas os 2 trechos vencedores
  const contextoFiltrado = topChunks
    .map((c) => `[Página ${c.pagina}] ${c.conteudo}`)
    .join('\n\n');

  // Passo E: Geração da resposta estruturada com múltiplas fontes
  console.log('\n4. Gerando resposta auditável com gemini-3.8-flash...');
  const resultado = await generateText({
    model: google('gemini-3.8-flash'),
    output: Output.object({
      schema: RespostaMultiCitacaoSchema,
    }),
    system:
      'Você é um auditor técnico corporativo. Responda exclusivamente com base nos trechos fornecidos e liste cada fonte individualmente.',
    prompt: `Trechos Recuperados:\n${contextoFiltrado}\n\nPergunta: ${pergunta}`,
  });

  console.log('\n=== RESPOSTA FINAL DO MOTOR RAG ===');
  console.log('Síntese:', resultado.output.respostaDireta);
  console.log('Confiança:', resultado.output.confianca);
  console.log('Fontes Auditadas:');
  for (const fonte of resultado.output.fontes) {
    console.log(`  * [Página ${fonte.paginaReferencia}]: "${fonte.citacaoExata}"`);
  }
  console.log('\nTokens totais gastos:', resultado.usage.totalTokens);
}

executarPipelineRAG().catch(console.error);