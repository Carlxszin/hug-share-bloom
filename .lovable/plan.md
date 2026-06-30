# Plano: Octopus 10× mais inteligente via métricas

A ideia é parar de tratar o Octopus como "um modelo que responde" e passar a tratá-lo como **um sistema que mede tudo, aprende com cada resposta e roteia inteligente** entre modelos/ferramentas. Sem mudar a UI atual — só ganhar inteligência por trás.

## 1. Camada de telemetria (fundação)

Criar `src/lib/metrics.ts` (localStorage, sem backend) que registra **por turno**:

- `intent` (chat / código / pesquisa / imagem / cálculo / voz)
- `model` usado, `tokensIn/Out`, `latencyMs`, `custoBRL`
- `toolCalls[]` (quais, quantas, sucesso/erro)
- `retryCount`, `truncated`, `userEditedAfter` (sinal de insatisfação)
- `thumb` (👍/👎 opcional no balão)
- `selfScore` (0-1) — auto-avaliação do próprio modelo no final

Tudo agregado em `metrics:rollup` (médias móveis de 50 turnos).

## 2. Painel "Inteligência" (visível ao chefe)

Botão novo no header → modal com:

- Acurácia percebida (👍 / total)
- Custo médio por resposta útil (R$)
- Latência p50/p95
- Taxa de uso de ferramenta vs. resposta direta
- Modelo campeão por intent (heatmap)
- Tendência (últimos 7 dias)

Mensurável = melhorável. Sem isso, "10× mais inteligente" é achismo.

## 3. Roteador adaptativo de modelo

`src/lib/router.ts` — antes de cada chamada, classifica a intent (heurística rápida + regex) e escolhe o modelo com **melhor score histórico** para aquela intent dentro de um teto de custo:

```text
intent=código  → gemini-3-flash (rápido) → escala p/ gpt-5.4 se selfScore<0.6
intent=chat    → gemini-3-flash-lite (barato)
intent=raciocínio profundo → gpt-5.5 / gemini-3.1-pro
intent=pesquisa → flash + tools (web_search, fetch_page)
```

Se o modelo barato falhar/auto-avaliar baixo → **escalonamento automático** para o premium e re-tentativa (1×). Resultado guardado para treinar o roteador.

## 4. Self-critique loop (qualidade real)

Depois de gerar resposta, em **1 chamada extra barata** (gemini-flash-lite), pedir:

```text
Pontue 0-1: precisão, completude, segue instrução, formatação. JSON.
```

- Score < 0.65 → regenera com modelo mais forte + nota interna do que faltou.
- Score guardado em métricas → alimenta roteador (passo 3).

Custo: ~R$0,0003/turno. Ganho de qualidade: alto.

## 5. Memória semântica (contexto persistente)

`src/lib/memory.ts` — após cada turno extrai (via flash-lite):

- Fatos sobre o chefe ("prefere respostas curtas", "trabalha com X")
- Projetos abertos / decisões / restrições
- Vocabulário recorrente

Armazena em localStorage com **embeddings locais** (`@xenova/transformers`, MiniLM, 100% grátis no browser). Antes de cada prompt: top-3 memórias mais similares vão no system prompt. Resultado: ele **lembra do chefe** entre conversas sem custo de API.

## 6. Prompt engineering versionado

`src/lib/prompts/` com versões A/B do system prompt (persona Octopus). Métricas comparam v1 vs v2 automaticamente — o vencedor vira default. Hoje o prompt é fixo e nunca melhora.

## 7. Cache semântico de respostas

Antes de chamar o modelo: embed da pergunta → se similaridade > 0.92 com pergunta recente → reusa resposta. Economiza ~20-30% das chamadas em uso real e responde instantâneo.

## 8. Métrica de "inteligência composta"

Um único número visível (0-100):

```text
IQ = 0.4·acurácia + 0.2·(1-latência_norm) + 0.2·(1-custo_norm)
   + 0.1·toolSuccess + 0.1·memoryHitRate
```

Antes/depois mensurável. Meta: sair de baseline (~40) para 80+ → o "10×" fica concreto.

## Ordem de entrega sugerida (incremental, cada passo já melhora)

1. **Telemetria + painel** (passos 1-2) — sem isso voamos cegos.
2. **Self-critique + escalonamento** (passo 4) — maior ganho de qualidade por R$.
3. **Roteador adaptativo** (passo 3) — corta custo e acelera.
4. **Memória semântica** (passo 5) — ganho de UX gigante.
5. **Cache semântico + A/B de prompts** (passos 6-7) — polimento.
6. **Score IQ composto** (passo 8) — fecha o ciclo.

## Detalhes técnicos

- Tudo client-side (localStorage + IndexedDB para embeddings). Zero infra nova.
- `@xenova/transformers` roda MiniLM no browser via WASM (~25MB, cacheado). Grátis.
- Self-critique e classificação de intent usam `google/gemini-3.1-flash-lite` via gateway Lovable (já configurado em `free-chat.ts`).
- Roteador é função pura → fácil de testar.
- Painel reaproveita `framer-motion` e estilo glass já existentes.
- Nada quebra modos atuais (chat/agente/chamada/imagem) — todos passam a logar métricas e ganhar self-critique opcional.

Posso começar pelo passo 1+2 (telemetria + painel) para você já enxergar o baseline antes de eu mexer no roteamento. Confirma, chefe?
