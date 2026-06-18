const axios = require('axios');

const URL = 'https://redmine.b2click.com';
const KEY = 'e238663df0ef862a4c3281ac98f4795379e3483e';
const ISSUE_ID = 89521;

const api = axios.create({
  baseURL: URL,
  headers: {
    'X-Redmine-API-Key': KEY,
    'Content-Type': 'application/json'
  }
});

// REMOVIDO: caracteres unicode especiais (↔ e —)
// REINSERIDO: @@Tabela
const LONG_NOTES = `h1. Estimativa Técnica: Tarefa #89521: Controle de Validade de Acesso

h2. 1. Levantamento Técnico

h3. 1.1 Modelo de Dados: Associação Usuário <-> Nível

|_. Artefato |_. Localização |
| Tabela de junção | @USUARIO_NIVEL@ (M:N entre @USUARIO@ e @NIVEL_USUARIO@) |
| PO Java | @UsuarioNiveisPO.java@ - campos: @codigo@ (PK), @usuario@ (FK), @nivel@ (FK). *Não possui coluna de data hoje.* |
| BO Java | @UsuarioBO.java@ - método @grava(UsuarioPO, long[] empresas, long[] niveis, ...)@ faz diff de arrays e chama @Dao.grava/exclui@ |
| PO Nível | @NivelUsuarioPO.java@ - tabela @NIVEL_USUARIO@ (@COD_NIVEL_USUARIO@, @NOME@, @GRUPO@). *Não possui flag de gerência temporária.* |
| Form Delphi 7 | @REDEERP7/Padrao/cadastros/FrmCadastroUsuario.pas@ |
| Form Delphi 12 | @DELPHI/B2CLICK_VCL/source/padrao/cadastros/FrmCadastroUsuario.pas@ |
| Grid "Níveis" | @gridNiveis: TSMDBGrid@ - *seleção por checkbox* (multi-select), 3 colunas: CODIGO, NOME, GRUPO. Dados via @cdsNiveis: TClientDataSet@. |

*Fluxo atual do save:* Delphi itera o grid, coleta os códigos dos níveis selecionados num @TArray@ de @Int64@, envia via @UsuarioBO.grava@. O Java faz diff (mantém existentes, cria novos, exclui removidos). *Não há estrutura para enviar data por nível hoje* - o parâmetro é @long[] niveis@.

h3. 1.2 Infraestrutura de Rotina Agendada

*Confirmação: JÁ EXISTE - framework "Agendador" maduro e extensível.*

|_. Artefato |_. Localização |
| Daemon | @ThreadAgendador.java@ - roda a cada 5 min, itera entidades, executa tarefas pendentes |
| PO (tabela AGENDADOR) | @AgendadorPO.java@ - schedule cron-like (meses, dias, horas, minutos) |
| Log de execução | @AgendadorLogPO.java@ - tabela @AGENDADOR_LOG@ |
| Interface de tarefa | @AgendadorTipoTarefaInterface.java@ |
| Auto-descoberta | Classes que implementam a interface são detectadas automaticamente no boot via classpath scan |

*Como registrar um novo job:* criar uma classe que implementa @AgendadorTipoTarefaInterface@ com @getCodigo()@ único. Inserir um registro na tabela @AGENDADOR@ com schedule desejado (ex.: diário às 00:00). O daemon já faz o resto. Existe 20 tarefas cadastradas como referência.

h3. 1.3 Infraestrutura de Auditoria

*Confirmação: JÁ EXISTE -* @LOG_DAO@ *cobre automaticamente a tabela* @USUARIO_NIVEL@*.*

|_. Artefato |_. Localização |
| Tabela de auditoria | @LOG_DAO@ - log campo-a-campo automático |
| PO/BO | @LogDAOPO.java@, @LogDAOBO.java@ |
| Mecanismo | @AbstractDao@ intercepta @grava()@ / @exclui()@ em POs com @@Tabela(gravaLog=true)@, compara antes/depois, grava uma linha por campo alterado |
| Cobertura | @UsuarioNiveisPO@ já tem @@Tabela(gravaLog=true)@ - *qualquer exclusão de nível via* @Dao.exclui()@ *já é logada automaticamente* |
| Relatório existente | @RelatorioAlteracoesCadastroTabelaComLog.java@ - consulta @LOG_DAO@ para qualquer tabela com log |
`;

async function test() {
  console.log("\\nTeste fix 4: sem Unicode mas COM @@Tabela");
  try {
    const res = await api.put(`/issues/${ISSUE_ID}.json`, {
      issue: {
        notes: LONG_NOTES
      }
    });
    console.log("Teste fix sucesso:", res.status);
  } catch (err) {
    console.log("Teste fix falhou:", err.response?.status, err.response?.data || err.message);
  }
}

test();
