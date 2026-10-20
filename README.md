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
| **Hoje** | Aulas, compromissos e treinos do dia (com "Faltei" e "Fiz / Não fiz"), prazos atrasados e próximos, treino do dia e metas no ritmo |
| **Essa semana** | Cronograma da semana em blocos de horário, de segunda a domingo: tudo o que você pretende fazer em cada hora. Blocos podem se repetir (toda semana, dias úteis, todo dia), ser marcados como feitos e mostram o total de horas planejadas por tipo. Aulas e compromissos aparecem ao fundo. Botão para esconder o fim de semana |
| **Horário de trabalho** | Cada pessoa informa dias, horário e tempo de deslocamento (ou "Não trabalho"); ida, trabalho e volta aparecem no fundo de Essa semana (fora da Agenda e de Hoje, porque é igual todo dia). Quem ainda não respondeu vê a pergunta em Hoje |
| **Agenda** | Mês, semana e dia. Compromissos com tipo fechado (Consulta com especialidade, Hangout e Compromisso com "com quem", Outro), recorrência e lembrete; aulas da grade, treinos e prazos. Clicar abre a ficha; "Editar" abre o formulário. Exporta `.ics` |
| **Faculdade** | Matérias com horários por dia, professor, sala e faltas registradas dia a dia, com limite automático de 4 faltas por dia de aula na semana (1 dia = 4, 2 dias = 8); em dia de duas aulas seguidas dá para faltar só numa (conta meia falta). Cada matéria diz como conta presença: lista, exercício ou chamada; na lista e no exercício dá para marcar "Assinaram por mim" / "Entreguei o exercício": fica registrado que você não assistiu, mas não conta falta) . Matéria pode ser marcada como **faltável** (checkbox): a falta fica registrada, mas não tem limite. No exercício dá para combinar a entrega em outro dia (vira prazo na agenda até marcar como entregue). Aula cancelada fica riscada na agenda e não tem falta. Qualquer dia (inclusive cancelado) pode ter presença por exercício, mesmo que a matéria normalmente seja lista ou chamada. Provas, trabalhos, seminários e atividades (lista fechada; atividade vale nota ou presença) com conteúdos cobrados e nota. Conteúdos estudados. Arquivos anexados (PDF, PPT, Word…). **Importa a grade do JupiterWeb** (USP) |
| **Trabalho** | Entregas com prazo, detalhes, prioridade e checklist, num quadro por status (arraste os cartões) |
| **Treinos** | Rotina fixa da semana (dias, horário, exercícios) que entra na agenda nesses horários; semana com "Fiz / Não fiz" em cada treino; ligado a uma meta, o treino feito já conta nela |
| **Metas** | Áreas (Fitness, Projetos paralelos…) com atividades e metas de **tempo**, **frequência** (por semana — padrão — ou mês) ou **objetivos**. Tempo de tela com limite diário e gráfico |
| **Admin** | Só para admins: criar usuários, mudar nome, redefinir senha, excluir |
| **Ajustes** | Conta (trocar senha, sair), horário de trabalho, ilustração da conta (imagem própria na barra lateral), temas (Clássico, **Naruto**, Sakura, Grafite), modo claro/escuro, cor de destaque, tipos de bloco, áreas, backup |

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
Júpiter. O limite de faltas sai dos dias de aula (4 por dia da semana). Reimportar atualiza as matérias pelo código, sem
duplicar. Toda a interpretação fica em `js/importar.js`; o favorito só coleta as tabelas, então
correções não exigem reinstalar o favorito.

## Contas, Admin e servidor (Supabase)

O app é estático (GitHub Pages) e usa o **Supabase** como servidor: login, banco de dados e as
funções de admin. A estrutura do banco está em [`supabase/schema.sql`](supabase/schema.sql).

- A tela de entrada é só **usuário e senha**. Ninguém cria a própria conta (cadastro aberto
  desligado no Supabase). No Supabase, cada usuário vira o e-mail interno
  `<usuario>@usuarios.organizador.invalid`.
- **Admins** (`profiles.is_admin` no banco; hoje só `gsanches`) veem a página **Admin**: criam
  usuários (nome, usuário e senha inicial), mudam nomes, redefinem senhas e excluem contas. As
  funções conferem no servidor se quem chama é admin.
- Cada pessoa troca a própria senha em **Ajustes → Trocar senha**, só digitando a nova
  (mínimo de 4 caracteres).
- Os dados pessoais ficam na tabela `items` (um registro do app por linha, em JSON). As regras do
  banco (RLS) só deixam cada pessoa ler e gravar as próprias linhas.
- **Sincronização:** cada alteração vai para a cópia local (IndexedDB) e para uma fila, enviada ao
  servidor em seguida. Sem internet, a fila espera. Ao abrir e ao voltar para o app, ele baixa o que
  mudou em outros aparelhos. Exclusões viram linhas com `deleted = true`.
- **Dados de antes do login:** se o navegador tem o banco local antigo, o app pergunta uma vez se
  quer levar esses dados para a conta.
- **Anexos** (PDFs etc.) ainda ficam só no aparelho onde foram adicionados.

### Mexer no servidor pelo Claude Code

O Claude Code usa a Management API do Supabase com um token pessoal guardado **fora do
repositório** (`~/.supabase-token`). Assim dá para pedir, por exemplo, "cadastra o João",
"torna a Maria admin" ou "aplica o schema de novo". A chave pública do projeto fica em
`js/config.js` (é feita para ficar no site); chaves secretas nunca entram no repositório.

## Estrutura

```
index.html            casca da página (menu lateral, barra inferior no celular)
styles.css            temas (tokens de cor/tipografia) + componentes + responsivo
js/core.js            utilidades de data/texto, ícones, constantes, estado
js/db.js              cópia local (IndexedDB), fila de sincronização e Store
js/ui.js              modal, diálogos, menus, toasts, campos de formulário
js/vendor/supabase.js biblioteca do Supabase (cópia fixa, v2.117.2, para funcionar offline)
js/config.js          endereço e chave pública do Supabase
js/auth.js            contas: login, sessão, troca de senha (Supabase)
js/agenda.js          recorrência, junção de itens, visões mês/semana/dia
js/expediente.js      horário de trabalho e deslocamento
js/semana.js          "Essa semana": cronograma em blocos de horário
js/faculdade.js       matérias, faltas, prazos, conteúdos, arquivos
js/importar.js        importar a grade do JupiterWeb (favorito ou colar)
js/trabalho.js        entregas e quadro
js/habitos.js         hábitos, tempo de tela, gráfico
js/metas.js           áreas, atividades, registros
js/hoje.js            painel do dia
js/ajustes.js         temas, preferências, exportações
js/admin.js           página Admin: usuários (funções do servidor)
supabase/schema.sql   estrutura do banco, regras de acesso e funções de admin
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
