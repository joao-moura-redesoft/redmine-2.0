// Extrai um "schema" dos campos editáveis a partir do formulário inline da
// página HTML da issue (a página show — que funciona com auth Basic, ao
// contrário da action /edit). Usado para renderizar o popup de campos
// obrigatórios sem depender da API REST (que no Redmine 4.2 não expõe isso).

// Decodifica entidades HTML comuns nos rótulos/opções.
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

function cleanLabel(raw) {
  // remove tags internas (ex.: <span class="required">*</span>) e o "*" final
  return decodeEntities(raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
    .replace(/\s*\*\s*$/, '').trim();
}

// Mapeia o id do elemento (issue_xxx) para o parâmetro de PUT do Redmine.
function paramFromId(id) {
  const cf = id.match(/^issue_custom_field_values_(\d+)$/);
  if (cf) return { kind: 'custom', cfId: Number(cf[1]) };
  const std = id.match(/^issue_(.+)$/);
  if (std) return { kind: 'standard', name: std[1] }; // ex.: estimated_hours, due_date
  return null;
}

function parseOptions(selectHtml) {
  return [...selectHtml.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
    .map(m => ({ value: m[1], label: cleanLabel(m[2]) }))
    .filter(o => o.value !== ''); // descarta o "--- Selecione ---"
}

// Recebe o HTML da página show e devolve a lista de campos do formulário.
function parseEditFormSchema(html) {
  const body = String(html);
  // Escopo: só dentro do formulário de edição (#issue-form), pra não pegar
  // campos de filtros/busca da página.
  const formMatch = body.match(/<form[^>]*id="issue-form"[\s\S]*?<\/form>/i);
  const scope = formMatch ? formMatch[0] : body;

  // 1) Coleta os rótulos por id de campo: <label for="issue_xxx">Rótulo</label>
  const labels = new Map();
  for (const m of scope.matchAll(/<label[^>]*for="(issue_[a-z0-9_]+)"[^>]*>([\s\S]*?)<\/label>/gi)) {
    labels.set(m[1], cleanLabel(m[2]));
  }

  const fields = [];
  const seen = new Set();
  for (const [id, label] of labels) {
    if (seen.has(id)) continue;
    seen.add(id);
    const param = paramFromId(id);
    if (!param) continue;

    // Acha o elemento correspondente (select / textarea / input) pelo id.
    const sel = scope.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`, 'i'));
    const txa = scope.match(new RegExp(`<textarea[^>]*id="${id}"[^>]*>`, 'i'));
    const inp = scope.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`, 'i'));

    let type = 'text';
    let options;
    if (sel) {
      type = 'select';
      options = parseOptions(sel[1]);
      if (new RegExp(`<select[^>]*id="${id}"[^>]*\\bmultiple\\b`, 'i').test(scope)) type = 'multiselect';
    } else if (txa) {
      type = 'textarea';
    } else if (inp) {
      const tag = inp[0];
      const t = (tag.match(/\btype="([^"]+)"/) || [])[1] || 'text';
      if (t === 'date') type = 'date';
      else if (t === 'checkbox') type = 'bool';
      else if (t === 'number') type = 'number';
      else type = 'text';
    } else {
      continue; // rótulo sem campo editável (ex.: campo somente leitura)
    }

    fields.push({ id, label, type, options, ...param });
  }
  return fields;
}

module.exports = { parseEditFormSchema, cleanLabel };
