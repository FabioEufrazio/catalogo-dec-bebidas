# Padrões de Desempenho e Layout Mobile (Catalogo DEC Bebidas)

Este documento estabelece as diretrizes fundamentais de desempenho, renderização e estabilidade móvel que DEVEM ser rigorosamente seguidas em todas as próximas implementações deste projeto.

---

## 1. Modais e Janelas Sobrepostas (Zero Sobrecarga de GPU)
- **Regra:** Todo modal ou overlay inativo DEVE ter `display: none;`.
- **Ativação:** Somente quando a classe `.active` for adicionada, o modal passa a ter `display: flex !important;`.
- **Proibição:** NUNCA deixar modais inativos com `display: flex; opacity: 0;` ou `pointer-events: none;`. No Android Chrome, isso obriga a GPU a manter camadas transparentes ativas em segundo plano, causando estouro de VRAM e **caixas pretas** sobre as fotos durante a rolagem.

---

## 2. Filtros Gráficos e Desfoque (Anti-Lags e Anti-Glitches)
- **Regra:** Evite usar `backdrop-filter: blur()` em:
  - Elementos repetidos em grade (como etiquetas de categoria, badges, cards de produtos).
  - Barras fixas ou sticky no topo enquanto o usuário rola a lista.
- **Alternativa:** Use cores com transparência direta e sólida (ex: `rgba(22, 25, 34, 0.95)`), que possuem custo computacional praticamente zero e renderizam de forma instantânea.
- **Camadas 3D:** Não force `transform: translateZ(0)` ou `contain: paint` em todos os cards desnecessariamente. Deixe a composição plana e nativa.

---

## 3. Viewport e Estabilidade de Largura Mobile (Fim do Corte Lateral)
- **Viewport Tag:** O arquivo `index.html` deve manter sempre:
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  ```
- **Contenção Horizontal:**
  - `html, body { width: 100%; max-width: 100%; overflow-x: hidden; }`
  - `.main-container, .products-grid { width: 100%; max-width: 100%; box-sizing: border-box; }`
  - `.product-card { min-width: 0; width: 100%; box-sizing: border-box; overflow: hidden; }`
- **Títulos:** Todo texto de produto deve ter `overflow: hidden; text-overflow: ellipsis; word-break: break-word;` para que nenhuma palavra comprida estufe a coluna para além da tela física do celular.

---

## 4. Rolagem Fluida e Nativa (120Hz / 60Hz)
- **Proibição:** NUNCA aplicar `scroll-behavior: smooth` ou `overscroll-behavior-y: none` globalmente na tag `html` ou `body`.
- **Motivo:** Esses comandos interferem no recálculo dinâmico da barra de endereço do navegador móvel e no scroll de alta taxa de atualização, gerando engasgos e tremores visuais.

---

## 5. Armazenamento em Nuvem e Imagens
- **Chunking Obrigatório:** Respeitar sempre o teto do Firestore (< 1 MiB por documento), particionando catálogo e encartes em blocos seguros (400 KB - 550 KB).
- **Timeouts Seguros:** Qualquer botão de sincronização em nuvem deve possuir trava de tempo (`Promise.race` com 12s - 15s) e `AbortController` nas requisições REST para garantir que o botão NUNCA fique travado girando.
