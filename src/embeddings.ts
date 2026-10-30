import 'dotenv/config';
import { embed, embedMany, cosineSimilarity } from 'ai';
import { google } from '@ai-sdk/google';

// 1. Interface TypeScript que define o formato de cada pedaço (Chunk) do documento
interface DocumentoChunk {
  id: string;
  pagina: number;
  conteudo: string;
}

// 2. Simulamos um documento já fatiado em 4 chunks de páginas diferentes
const baseConhecimento: DocumentoChunk[] = [
  {
    id: 'chunk-1',
    pagina: 14,
    conteudo:
      'Política de Trabalho Remoto: Todo engenheiro de software em regime remoto tem direito a um reembolso anual de até US$ 1.500 para atualização de hardware ergonômico.',
  },
  {
    id: 'chunk-2',
    pagina: 15,
    conteudo:
      'Segurança de Rede e Infraestrutura: O acesso aos servidores de produção exige autenticação via chave SSH com certificado corporativo renovado obrigatoriamente a cada 90 dias.',
  },
  {
    id: 'chunk-3',
    pagina: 22,
    conteudo:
      'Política de Férias e Recesso: O colaborador pode parcelar suas férias anuais em até 3 períodos, desde que um deles não seja inferior a 14 dias corridos.',
  },
  {
    id: 'chunk-4',
    pagina: 31,
    conteudo:
      'Despesas de Viagem Corporativa: Alimentação durante viagens a trabalho é reembolsada até o limite diário de US$ 80 mediante apresentação de nota fiscal.',
  },
];

// 3. Definimos o modelo de Embedding do Google
// Nota: Se sua chave pedir o modelo mais recente, basta trocar para 'gemini-embedding-001'
const modeloEmbedding = google.textEmbeddingModel('gemini-embedding-001');

async function executarBuscaSemantica() {
  // Repare no teste: NÃO usamos as palavras "reembolso", "hardware" ou "ergonômico"
  const perguntaUsuario =
    'A empresa ajuda a pagar se eu comprar uma cadeira e um monitor novos para trabalhar de casa?';

  console.log(`Pergunta do usuário: "${perguntaUsuario}"\n`);
  console.log('1. Gerando embeddings (vetores) para os 4 chunks do documento...');

  // 4. Converte todos os chunks em vetores numéricos em uma única chamada (Batch)
  const { embeddings: vetoresDocumento } = await embedMany({
    model: modeloEmbedding,
    values: baseConhecimento.map((chunk) => chunk.conteudo),
  });

  console.log(
    `Sucesso! Cada trecho de texto virou um vetor com ${vetoresDocumento[0].length} dimensões numéricas.`
  );
  console.log('Amostra dos 5 primeiros números do chunk-1:', vetoresDocumento[0].slice(0, 5));

  // 5. Converte a pergunta do usuário em um vetor numérico
  console.log('\n2. Convertendo a pergunta em vetor e comparando significados...');
  const { embedding: vetorPergunta } = await embed({
    model: modeloEmbedding,
    value: perguntaUsuario,
  });

  // 6. Calcula a Similaridade de Cosseno entre a pergunta e cada chunk
  const resultadosRanqueados = baseConhecimento
    .map((chunk, index) => ({
      ...chunk,
      similaridade: cosineSimilarity(vetorPergunta, vetoresDocumento[index]),
    }))
    // Ordena do maior score de similaridade para o menor
    .sort((a, b) => b.similaridade - a.similaridade);

  console.log('\n=== RANKING DE RELEVÂNCIA SEMÂNTICA ===');
  for (const item of resultadosRanqueados) {
    const porcentagem = (item.similaridade * 100).toFixed(1);
    console.log(`[Score: ${porcentagem}%] (Pág. ${item.pagina} | ${item.id}) -> ${item.conteudo}`);
  }
}

executarBuscaSemantica().catch(console.error);