# Organizador pessoal — protótipo

Agenda, faculdade, trabalho, hábitos, tempo de tela e metas num só lugar.
HTML + CSS + JavaScript puro, sem dependências nem etapa de build.

## Como abrir

- **Computador:** dê dois cliques em `index.html` (Chrome ou Edge).
- **Celular / instalar como app:** sirva a pasta por http e abra no navegador do celular:
  ```
  npx serve .        # ou: python -m http.server 8080
  ```
  Para instalar no celular de verdade, publique em um endereço HTTPS
  (GitHub Pages, Netlify, Vercel…) e use "Adicionar à tela inicial".

## O que tem

| Tela | Recursos |
|---|---|
| **Hoje** | Aulas e compromissos do dia, quantas vezes ainda pode faltar em cada aula, botão "Faltei", prazos atrasados e próximos, hábitos do dia, tempo de tela e progresso das metas |
| **Essa semana** | Cronograma da semana em blocos de horário, de segunda a domingo: tudo o que você pretende fazer em cada hora. Blocos podem se repetir (toda semana, dias úteis, todo dia), ser marcados como feitos e mostram o total de horas planejadas por tipo. Aulas e compromissos aparecem ao fundo. Botão para esconder o fim de semana |
| **Agenda** | Mês, semana e dia. Junta compromissos/consultas (com recorrência e lembrete), aulas da grade e prazos. Exporta `.ics` |
| **Faculdade** | Matérias com horários por dia, professor, sala e faltas registradas dia a dia, com limite automático de 30% das aulas do semestre. Provas, trabalhos e atividades com conteúdos cobrados e nota. Conteúdos estudados. Arquivos anexados (PDF, PPT, Word…). **Importa a grade do JupiterWeb** (USP) |
| **Trabalho** | Entregas com prazo, detalhes, prioridade e checklist, num quadro por status (arraste os cartões) |
| **Hábitos** | Hábitos personalizáveis (sim/não ou quantidade, dias da semana), sequência e tempo de tela com limite diário e gráfico |
| **Metas** | Áreas (Fitness, Date, Projetos paralelos…) com atividades e metas de **tempo**, **frequência** (por semana — padrão — ou mês) ou **objetivos** |
| **Ajustes** | Conta (trocar senha, sair), temas (Clássico, **Naruto**, Sakura, Grafite), modo claro/escuro, cor de destaque, tipos de compromisso, áreas, backup |

Atalhos: `N` novo · `E` compromisso · `B` bloco na semana · `P` prazo da faculdade · `W` entrega · `1`–`8` telas · `←` `→` agenda e semana.

## Importar a grade do JupiterWeb

Em **Faculdade → Importar do Júpiter** há duas formas:

- **Favorito** (computador): arraste o botão “Grade → Organizador” para a barra de favoritos, abra a
  Grade Horária no JupiterWeb e clique nele. O favorito roda na própria página do Júpiter, lê a grade
  e as páginas públicas de cada disciplina (`obterDisciplina` e `obterTurma`: nome, professores,
  sala, início e fim da turma) e abre o organizador com os dados depois do `#` do endereço — essa
  parte não é enviada a servidor nenhum. Nada é salvo antes de você conferir.
- **Colar**: copie a grade no Júpiter e cole no campo. Vêm só códigos e horários.

Cada horário vira aulas de 50 min (19:30–21:10 = 2 aulas), o que bate com os créditos-aula do
Júpiter e alimenta o limite de faltas (30%). Reimportar atualiza as matérias pelo código, sem
duplicar. Toda a interpretação fica em `js/importar.js`; o favorito só coleta as tabelas, então
correções não exigem reinstalar o favorito.

## Contas

O app abre numa tela de login. Cada conta tem a **sua própria agenda e os seus próprios dados**
(um banco IndexedDB por conta). As contas ficam num banco separado (`organizador-contas`), e a
senha **nunca é gravada**: só um hash PBKDF2-SHA256 (600 mil iterações) com sal aleatório.
A primeira conta criada no aparelho herda os dados que já existiam antes do login.

Por enquanto tudo é local: uma conta criada no computador não existe no celular, e quem tem
acesso ao navegador consegue ler os dados pelas ferramentas de desenvolvedor (o login separa as
contas, mas não criptografa os dados). Isso muda quando houver um servidor.

## Estrutura

```
index.html            casca da página (menu lateral, barra inferior no celular)
styles.css            temas (tokens de cor/tipografia) + componentes + responsivo
js/core.js            utilidades de data/texto, ícones, constantes, estado
js/db.js              banco de dados (IndexedDB) + Store (cópia em memória)
js/ui.js              modal, diálogos, menus, toasts, campos de formulário
js/auth.js            contas: cadastro, login, sessão, troca de senha
js/agenda.js          recorrência, junção de itens, visões mês/semana/dia
js/semana.js          "Essa semana": cronograma em blocos de horário
js/faculdade.js       matérias, faltas, prazos, conteúdos, arquivos
js/importar.js        importar a grade do JupiterWeb (favorito ou colar)
js/trabalho.js        entregas e quadro
js/habitos.js         hábitos, tempo de tela, gráfico
js/metas.js           áreas, atividades, registros
js/hoje.js            painel do dia
js/ajustes.js         temas, preferências, exportações
js/app.js             rotas, eventos globais, lembretes, inicialização
sw.js + manifest      funcionamento offline e instalação (PWA)
```

## Banco de dados

O protótipo usa **IndexedDB**, um banco de dados real dentro do navegador, que guarda
inclusive os arquivos anexados. Cada coleção abaixo vira uma tabela quando migrarmos para
um servidor:

`events` · `categories` · `subjects` (com `slots` de horário) · `absences` · `assessments` ·
`contents` · `files` (+ `blobs`) · `deliverables` · `habits` · `habitLogs` · `screenTime` ·
`areas` · `activities` · `activityLogs` · `blocks`

As telas só conversam com o objeto `Store` (`js/db.js`). Para sincronizar entre o computador
e o celular, basta trocar a implementação de `DB` por chamadas a um backend.
Sugestão: **Supabase** (Postgres + login + armazenamento de arquivos + tempo real).

## Próximos passos sugeridos

1. Backend com login e sincronização (Supabase) — os dados passam a valer em qualquer aparelho.
2. App mobile: publicar como PWA (já preparado) e, se precisar de lojas, empacotar com Capacitor.
3. Notificações push de prazos (precisam do backend).
4. Importar tempo de tela automaticamente (exige app nativo no celular).

## Como criar um tema novo

Em `styles.css`, copie o bloco `[data-palette="sakura"]` (e o `[data-mode="dark"]` dele),
troque as cores/fontes e adicione o tema na lista `PALETTES` em `js/core.js`.
