import 'dotenv/config';
import { generateText, Output } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

// 1. Contrato de dados estrito com Zod
const RespostaAuditavelSchema = z.object({
  respostaDireta: z
    .string()
    .describe('A resposta clara e objetiva para a pergunta do usuário.'),
  citacaoExata: z
    .string()
    .describe('O trecho literal copiado do documento que comprova a resposta.'),
  paginaReferencia: z
    .number()
    .describe('O número da página de onde a informação foi extraída.'),
  confianca: z
    .enum(['ALTA', 'MEDIA', 'BAIXA'])
    .describe('Nível de certeza baseado exclusivamente no texto fornecido.'),
});

// 2. Documento corporativo simulado
const documentoFicticio = `
[Página 14] Política de Trabalho Remoto e Equipamentos (Revisão 2026):
Parágrafo 1: Todo engenheiro de software contratado em regime remoto tem direito a um reembolso anual de até US$ 1.500 para atualização de hardware ergonômico.
[Página 15] Segurança de Rede:
Parágrafo 2: O acesso aos servidores de produção exige autenticação via chave SSH com certificado corporativo renovado a cada 90 dias.
`;

async function executarTesteRAG() {
  const perguntaUsuario =
    'Qual é o valor máximo para reembolso de equipamentos e a cada quanto tempo preciso renovar minha chave SSH?';

  console.log('Consultando o modelo gemini-3.8-flash com validação estrita...\n');

  // 3. Padrão moderno do AI SDK: generateText + Output.object
  const resultado = await generateText({
    model: google('gemini-3.8-flash'),
    output: Output.object({
      schema: RespostaAuditavelSchema,
    }),
    system:
      'Você é um assistente corporativo rigoroso. Responda APENAS com base no documento fornecido.',
    prompt: `Documento Base:\n${documentoFicticio}\n\nPergunta: ${perguntaUsuario}`,
  });

  // 4. O objeto validado pelo Zod fica disponível em resultado.output
  console.log('=== RESPOSTA ESTRUTURADA RECEBIDA ===');
  console.log('Resposta:', resultado.output.respostaDireta);
  console.log('Citação Literal:', `"${resultado.output.citacaoExata}"`);
  console.log('Página:', resultado.output.paginaReferencia);
  console.log('Confiança:', resultado.output.confianca);
  console.log('\nTokens utilizados:', resultado.usage.totalTokens);
}

executarTesteRAG().catch(console.error);