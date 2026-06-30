const { markdownToTextile } = require('./client/src/utils/markdownToTextile.ts');

// I can't require TS directly in Node without ts-node, I'll just copy the function.
const fs = require('fs');
const content = fs.readFileSync('./client/src/utils/markdownToTextile.ts', 'utf8');
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const isTableRow = (l) => l.includes('|') && /\S/.test(l);
const isDelimRow = (l) => l.includes('-') && TABLE_DELIM_RE.test(l);

function splitCells(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map(c => c.trim());
}

function convertTables(s) {
  const lines = s.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const delim = lines[i + 1];
    if (header !== undefined && delim !== undefined && isTableRow(header) && isDelimRow(delim)) {
      const headerCells = splitCells(header);
      out.push('|' + headerCells.map(c => `_. ${c} `).join('|') + '|');
      i += 1; // descarta o separador
      while (i + 1 < lines.length && isTableRow(lines[i + 1]) && !isDelimRow(lines[i + 1])) {
        i += 1;
        out.push('| ' + splitCells(lines[i]).join(' | ') + ' |');
      }
    } else {
      out.push(header);
    }
  }
  return out.join('\n');
}

function mdToTx(md) {
  if (!md) return '';
  let s = md.replace(/\r\n/g, '\n');

  const blocks = [];
  s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(code.replace(/\n+$/, ''));
    return ` B${blocks.length - 1} `;
  });

  const inlines = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    inlines.push(c);
    return ` I${inlines.length - 1} `;
  });

  s = convertTables(s);

  s = s.split('\n').map(line => {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) return `h${h[1].length}. ${h[2]}`;
    if (/^>\s?/.test(line)) return line.replace(/^>\s?/, 'bq. ');
    if (/^\s*[-*+]\s+/.test(line)) return line.replace(/^\s*[-*+]\s+/, '* ');
    if (/^\s*\d+\.\s+/.test(line)) return line.replace(/^\s*\d+\.\s+/, '# ');
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return '---'; 
    return line;
  }).join('\n');

  s = s.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '!$1!');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '"$1":$2');

  const bolds = [];
  const stashBold = (_, x) => {
    bolds.push(x);
    return ` N${bolds.length - 1} `;
  };
  s = s.replace(/\*\*([^*\n]+)\*\*/g, stashBold).replace(/__([^_\n]+)__/g, stashBold);

  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, '$1_$2_');
  s = s.replace(/~~([^~\n]+)~~/g, '-$1-');
  s = s.replace(/ N(\d+) /g, (_, i) => `*${bolds[+i]}*`);
  s = s.replace(/ I(\d+) /g, (_, i) => `@${inlines[+i]}@`);
  s = s.replace(/ B(\d+) /g, (_, i) => `<pre>\n${blocks[+i]}\n</pre>`);

  return s;
}

const LONG_NOTES = `h1. Estimativa Técnica: Tarefa #89521: Controle de Validade de Acesso

h2. 1. Levantamento Técnico

h3. 1.1 Modelo de Dados: Associação Usuário ↔ Nível

|_. Artefato |_. Localização |
| Tabela de junção | @USUARIO_NIVEL@ (M:N entre @USUARIO@ e @NIVEL_USUARIO@) |
| PO Java | @UsuarioNiveisPO.java@ — campos: @codigo@ (PK), @usuario@ (FK), @nivel@ (FK). *Não possui coluna de data hoje.* |
| BO Java | @UsuarioBO.java@ — método @grava(UsuarioPO, long[] empresas, long[] niveis, ...)@ faz diff de arrays e chama @Dao.grava/exclui@ |
| PO Nível | @NivelUsuarioPO.java@ — tabela @NIVEL_USUARIO@ (@COD_NIVEL_USUARIO@, @NOME@, @GRUPO@). *Não possui flag de "gerência temporária".* |
| Form Delphi 7 | @REDEERP7/Padrao/cadastros/FrmCadastroUsuario.pas@ |
| Form Delphi 12 | @DELPHI/B2CLICK_VCL/source/padrao/cadastros/FrmCadastroUsuario.pas@ |
| Grid "Níveis" | @gridNiveis: TSMDBGrid@ — *seleção por checkbox* (multi-select), 3 colunas: CODIGO, NOME, GRUPO. Dados via @cdsNiveis: TClientDataSet@. |

*Fluxo atual do save:* Delphi itera o grid, coleta os códigos dos níveis selecionados num @TArray@ de @Int64@, envia via @UsuarioBO.grava@. O Java faz diff (mantém existentes, cria novos, exclui removidos). *Não há estrutura para enviar data por nível hoje* — o parâmetro é @long[] niveis@.

h3. 1.2 Infraestrutura de Rotina Agendada

*Confirmação: JÁ EXISTE — framework "Agendador" maduro e extensível.*

|_. Artefato |_. Localização |
| Daemon | @ThreadAgendador.java@ — roda a cada 5 min, itera entidades, executa tarefas pendentes |
| PO (tabela AGENDADOR) | @AgendadorPO.java@ — schedule cron-like (meses, dias, horas, minutos) |
| Log de execução | @AgendadorLogPO.java@ — tabela @AGENDADOR_LOG@ |
| Interface de tarefa | @AgendadorTipoTarefaInterface.java@ |
| Auto-descoberta | Classes que implementam a interface são detectadas automaticamente no boot via classpath scan |

*Como registrar um novo job:* criar uma classe que implementa @AgendadorTipoTarefaInterface@ com @getCodigo()@ único. Inserir um registro na tabela @AGENDADOR@ com schedule desejado (ex.: diário às 00:00). O daemon já faz o resto. Existe \\~20 tarefas cadastradas como referência.\`;

console.log(mdToTx(LONG_NOTES));
