# Monitor BTC/USDT (Binance)

Sistema web que:
- Conecta ao WebSocket público da Binance (aggTrade) e atualiza preço em tempo real
- Mantém pico recente (máximo) e calcula:
  - Drawdown absoluto para alertas
  - Variação com sinal para exibição (verde acima do pico, vermelho abaixo)
- Exibe status de conexão (Online/Offline), latência e último tick
- Calcula custos (taxa, spread, slippage) e mostra breakeven
- Registra “Picos recentes” com idade, drawdown máximo e origem (manual/auto/novo topo)
- UI com tooltips, tour guiado e seção de layout configurável (larguras)

## Requisitos
- Node.js 16+
- NPM

## Instalação
```bash
npm install
```

## Execução
```bash
npm start
# Abra http://localhost:3000
```

## Estrutura
- `server.js`: Express servindo o frontend e recebendo POST `/alert`
- `public/`:
  - `index.html`: UI
  - `styles.css`: estilos (usa variáveis CSS)
  - `app.js`: lógica (WebSocket, drawdown, picos, layout, tooltips, tour, **gráfico**)
  - `chart.umd.js`: Chart.js (incluído localmente)
- `env.example`: exemplo de variáveis de ambiente (PORT)

## Controles principais
- Mín/Máx (%): faixa de drawdown absoluto para disparar alertas
- Reset (min): tempo para reset automático do pico
- Símbolo: par da Binance (ex.: btcusdt)
- Botões: Aplicar, Resetar Pico, Silenciar

## Gráfico de Preços
O gráfico mostra os últimos 100 pontos de preço em tempo real:
- Atualização automática com cada tick do WebSocket
- Tema escuro integrado ao design
- **Inicialização defensiva**: Se Chart.js falhar ao carregar, o app continua funcionando normalmente sem o gráfico

## Seção “Layout”
No topo, três campos:
- Largura dos campos (px): largura máxima dos inputs
- Largura dos cards (px): largura máxima dos cards
- Coluna da tabela (px): largura da coluna “Picos recentes”

Clique “Aplicar layout” para salvar (localStorage). “Padrão” restaura os valores.

## Picos recentes
- Registros aparecem quando a idade do pico > 10s
- Origem: Manual (reset), Auto (janela), Novo topo (quando preço supera pico)
- Editável: Data/Hora, Preço, Origem; Idade e DD máx são calculados
- Exportar CSV e Limpar disponíveis

## Observações
- Este sistema é informativo e não executa ordens.
- Não versionamos `node_modules`; instale dependências com `npm install`.
- Chart.js está incluído localmente (`public/chart.umd.js`) para garantir funcionamento offline.

## Licença
MIT — veja `LICENSE`.