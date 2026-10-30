import 'dotenv/config';
import process from 'node:process';
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { embed, streamText, Output } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

// 1. Otimização de Rede para Windows (evita congelamento de sockets IPv6 no Node 20+)
dns.setDefaultResultOrder('ipv4first');
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const modeloEmbedding = google.textEmbeddingModel('gemini-embedding-001');

// 2. Contrato Zod Auditável
const RespostaBlindadaSchema = z.object({
  statusAtendimento: z.enum([
    'ATENDIDO_INTEGRALMENTE',
    'ATENDIDO_PARCIALMENTE',
    'RECUSADO_SEM_BASE',
  ]),
  respostaAuditada: z.string(),
  topicosSemEvidencia: z.array(z.string()),
  fontes: z.array(
    z.object({
      paginaReferencia: z.number(),
      citacaoExata: z.string(),
    })
  ),
});

const NOTA_DE_CORTE = 0.60;

// 3. Interface Web (Painel Dark Mode de Engenharia de IA + Observabilidade)
const PAGINA_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Enterprise Hybrid-RAG Engine</title>
  <style>
    :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #f8fafc; --muted: #94a3b8; --accent: #38bdf8; --ok: #22c55e; --warn: #eab308; --err: #ef4444; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { background: var(--bg); color: var(--text); margin: 0; padding: 24px; max-width: 1100px; margin-inline: auto; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; display: flex; align-items: center; gap: 10px; }
    .subtitle { color: var(--muted); font-size: 0.9rem; margin-bottom: 20px; }
    .search-box { display: flex; gap: 10px; margin-bottom: 16px; }
    input { flex: 1; padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 0.95rem; }
    button { padding: 12px 20px; border-radius: 8px; border: none; background: var(--accent); color: #0f172a; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: wait; }
    .presets { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .preset-btn { background: var(--card); color: var(--muted); border: 1px solid var(--border); padding: 6px 12px; font-size: 0.8rem; font-weight: 500; border-radius: 6px; cursor: pointer; }
    .preset-btn:hover { border-color: var(--accent); color: var(--text); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
    .card h2 { font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-top: 0; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .metric-box { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
    .metric-label { font-size: 0.75rem; color: var(--muted); }
    .metric-val { font-size: 1.2rem; font-weight: 700; margin-top: 4px; color: var(--accent); }
    .chunk { padding: 10px; border-radius: 6px; background: #0f172a; margin-bottom: 8px; border-left: 4px solid var(--border); font-size: 0.85rem; }
    .chunk.aprovado { border-left-color: var(--ok); }
    .chunk.descartado { border-left-color: var(--err); opacity: 0.65; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; }
    .badge.ok { background: rgba(34,197,94,0.2); color: var(--ok); }
    .badge.warn { background: rgba(234,179,8,0.2); color: var(--warn); }
    .badge.err { background: rgba(239,68,68,0.2); color: var(--err); }
    .citacao { background: #0f172a; padding: 10px; border-radius: 6px; border-left: 3px solid var(--accent); font-style: italic; font-size: 0.85rem; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Enterprise Hybrid-RAG Engine <span class="badge ok">TypeScript + pgvector + Zod</span></h1>
  <div class="subtitle">Busca Híbrida (Semântica + Full-Text), Guardrail de Nota de Corte (60%) e Streaming Estruturado em Tempo Real</div>

  <div class="search-box">
    <input id="pergunta" placeholder="Digite uma pergunta corporativa para auditar nos manuais..." />
    <button id="btnBuscar" onclick="executarRAG()">Auditar Base</button>
  </div>

  <div class="presets">
    <button class="preset-btn" onclick="testar('Qual o valor de reembolso de equipamentos e a regra da chave SSH?')">Teste 1: Multi-Fonte (Págs. 14 e 15)</button>
    <button class="preset-btn" onclick="testar('Qual o procedimento para o erro ERR-904-DB e qual o valor do auxílio creche?')">Teste 2: Parcial + Bloqueio de Alucinação</button>
    <button class="preset-btn" onclick="testar('Como cadastrar minha digital na catraca do estacionamento?')">Teste 3: Short-Circuit (0 Tokens)</button>
  </div>

  <div class="metrics">
    <div class="metric-box"><div class="metric-label">STATUS DO GUARDRAIL</div><div class="metric-val" id="mStatus">-</div></div>
    <div class="metric-box"><div class="metric-label">LATÊNCIA TOTAL</div><div class="metric-val" id="mLatencia">-</div></div>
    <div class="metric-box"><div class="metric-label">TOKENS CONSUMIDOS</div><div class="metric-val" id="mTokens">-</div></div>
    <div class="metric-box"><div class="metric-label">CUSTO ESTIMADO (USD)</div><div class="metric-val" id="mCusto">-</div></div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>1. Recuperação Híbrida (Supabase pgvector)</h2>
      <div id="listaChunks">Aguardando consulta...</div>
    </div>
    <div class="card">
      <h2>2. Resposta Auditada em Streaming (Gemini + Zod)</h2>
      <div id="painelResposta">Aguardando consulta...</div>
    </div>
  </div>

  <script>
    function testar(texto) {
      document.getElementById('pergunta').value = texto;
      executarRAG();
    }

    async function executarRAG() {
      const pergunta = document.getElementById('pergunta').value.trim();
      if (!pergunta) return;

      const btn = document.getElementById('btnBuscar');
      btn.disabled = true;
      document.getElementById('listaChunks').innerHTML = 'Buscando vetores e índice textual no Supabase...';
      document.getElementById('painelResposta').innerHTML = 'Aguardando filtro de Guardrail...';
      document.getElementById('mStatus').innerText = 'PROCESSANDO...';
      document.getElementById('mLatencia').innerText = '...';
      document.getElementById('mTokens').innerText = '...';
      document.getElementById('mCusto').innerText = '...';

      const inicio = performance.now();
      const response = await fetch('/api/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pergunta })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const linhas = buffer.split('\\n\\n');
        buffer = linhas.pop() || '';

        for (const bloco of linhas) {
          if (!bloco.startsWith('data: ')) continue;
          const evento = JSON.parse(bloco.replace('data: ', ''));

          if (evento.tipo === 'chunks') {
            document.getElementById('listaChunks').innerHTML = evento.dados.map(c => \`
              <div class="chunk \${c.aprovado ? 'aprovado' : 'descartado'}">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                  <strong>Página \${c.pagina}</strong>
                  <span class="badge \${c.aprovado ? 'ok' : 'err'}">\${c.aprovado ? 'APROVADO' : 'DESCARTADO (< 60%)'}</span>
                </div>
                <div style="color:#94a3b8; font-size:0.78rem; margin-bottom:6px;">
                  Híbrido: <b>\${(c.score_hibrido*100).toFixed(1)}%</b> | Semântico: <b>\${(c.score_semantico*100).toFixed(1)}%</b> | Texto: <b>\${c.score_textual.toFixed(2)}</b>
                </div>
                <div>\${c.conteudo}</div>
              </div>
            \`).join('');
          }

          if (evento.tipo === 'parcial' || evento.tipo === 'final') {
            const obj = evento.objeto || {};
            document.getElementById('mStatus').innerText = obj.statusAtendimento || 'GERANDO...';
            let html = \`<p style="line-height:1.5;">\${obj.respostaAuditada || '...'}</p>\`;

            if (obj.topicosSemEvidencia && obj.topicosSemEvidencia.length > 0) {
              html += \`<div style="margin-top:10px;"><span class="badge warn">Tópicos Recusados (Sem Evidência):</span><ul>\${obj.topicosSemEvidencia.map(t => \`<li>\${t}</li>\`).join('')}</ul></div>\`;
            }
            if (obj.fontes && obj.fontes.length > 0) {
              html += \`<div style="margin-top:12px;"><strong>Citações Literais Auditadas:</strong>\${obj.fontes.map(f => \`<div class="citacao">[Pág. \${f.paginaReferencia}] "\${f.citacaoExata || ''}"</div>\`).join('')}</div>\`;
            }
            document.getElementById('painelResposta').innerHTML = html;
          }

          if (evento.tipo === 'final') {
            const ms = ((performance.now() - inicio) / 1000).toFixed(2);
            document.getElementById('mLatencia').innerText = ms + 's';
            document.getElementById('mTokens').innerText = evento.tokens;
            const custo = ((evento.tokens / 1000000) * 0.15).toFixed(6);
            document.getElementById('mCusto').innerText = '$' + custo;
          }
        }
      }
      btn.disabled = false;
    }
  </script>
</body>
</html>`;

// 4. Função utilitária para enviar eventos em tempo real (SSE) para o navegador
function enviarEventoSSE(res: http.ServerResponse, dados: unknown) {
  res.write(`data: ${JSON.stringify(dados)}\n\n`);
}

// 5. Criação do Servidor HTTP
const server = http.createServer(async (req, res) => {
  // Rota Principal: Entrega a Interface Web
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINA_HTML);
    return;
  }

  // Rota da API de RAG com Streaming SSE
  if (req.method === 'POST' && req.url === '/api/rag') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { pergunta } = JSON.parse(body);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        // Passo 1: Vetoriza a pergunta e consulta o Supabase
        const { embedding: vetorPergunta } = await embed({
          model: modeloEmbedding,
          value: pergunta,
        });

        const { data: candidatos, error } = await supabase.rpc(
          'buscar_documentos_hibrido',
          {
            query_text: pergunta,
            query_embedding: vetorPergunta,
            match_count: 3,
          }
        );

        if (error) throw error;

        // Passo 2: Avalia o Guardrail e envia os chunks IMEDIATAMENTE para a tela
        const chunksComStatus = candidatos.map((c: any) => ({
          ...c,
          aprovado: c.score_semantico >= NOTA_DE_CORTE || c.score_textual > 0.05,
        }));

        enviarEventoSSE(res, { tipo: 'chunks', dados: chunksComStatus });

        const aprovados = chunksComStatus.filter((c: any) => c.aprovado);

        // Short-Circuit: Se nada passou na nota de corte, encerra gastando 0 tokens!
        if (aprovados.length === 0) {
          enviarEventoSSE(res, {
            tipo: 'final',
            tokens: 0,
            objeto: {
              statusAtendimento: 'RECUSADO_SEM_BASE',
              respostaAuditada:
                'Bloqueio Anti-Alucinação: Nenhum documento atingiu a nota de corte mínima de 60% de relevância. O LLM não foi acionado.',
              topicosSemEvidencia: [pergunta],
              fontes: [],
            },
          });
          res.end();
          return;
        }

        // Passo 3: Faz o Streaming em tempo real do objeto validado pelo Zod
        const contexto = aprovados
          .map((c: any) => `[Página ${c.pagina}] ${c.conteudo}`)
          .join('\n\n');

        const resultadoStream = streamText({
          model: google('gemini-3.8-flash'),
          output: Output.object({ schema: RespostaBlindadaSchema }),
          temperature: 0,
          providerOptions: {
            google: { thinkingConfig: { thinkingBudget: 0 } },
          },
          system: `Você é um auditor técnico rigoroso.
1. Responda APENAS o que estiver comprovado nos trechos.
2. Se faltar evidência para parte da pergunta, marque ATENDIDO_PARCIALMENTE e preencha topicosSemEvidencia.`,
          prompt: `Trechos Oficiais:\n${contexto}\n\nPergunta: ${pergunta}`,
        });

        // Envia cada pedacinho do JSON conforme o modelo vai escrevendo!
        for await (const objetoParcial of resultadoStream.partialOutputStream) {
          enviarEventoSSE(res, { tipo: 'parcial', objeto: objetoParcial });
        }

        const objetoFinal = await resultadoStream.output;
        const uso = await resultadoStream.usage;

        enviarEventoSSE(res, {
          tipo: 'final',
          tokens: uso.totalTokens ?? 0,
          objeto: objetoFinal,
        });

        res.end();
      } catch (err: any) {
        enviarEventoSSE(res, {
          tipo: 'final',
          tokens: 0,
          objeto: {
            statusAtendimento: 'RECUSADO_SEM_BASE',
            respostaAuditada: `Erro ao processar: ${err.message}`,
            topicosSemEvidencia: [],
            fontes: [],
          },
        });
        res.end();
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORTA = 3000;
server.listen(PORTA, () => {
  console.log(`\nServidor Enterprise Hybrid-RAG rodando em: http://localhost:${PORTA}`);
  console.log('Abra o link acima no seu navegador para usar o painel em tempo real!');
});