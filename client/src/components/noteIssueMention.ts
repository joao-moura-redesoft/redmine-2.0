import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

// Decora referências #1234 no texto para ficarem clicáveis (abrem a tarefa)
function buildDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  const re = /(?<!\w)#(\d+)(?!\w)/g;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node.text)) !== null) {
      const from = pos + m.index;
      const to = from + m[0].length;
      decos.push(Decoration.inline(from, to, { class: 'note-issue-link', 'data-issue-id': m[1] }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export interface IssueMentionOptions {
  onIssueClick?: (id: number) => void;
}

export const IssueMention = Extension.create<IssueMentionOptions>({
  name: 'issueMention',
  addOptions() {
    return { onIssueClick: undefined };
  },
  addProseMirrorPlugins() {
    const onIssueClick = this.options.onIssueClick;
    return [
      new Plugin({
        key: new PluginKey('issueMention'),
        state: {
          init: (_config, { doc }) => buildDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement | null;
            if (target?.classList?.contains('note-issue-link')) {
              const id = Number(target.getAttribute('data-issue-id'));
              if (id && onIssueClick) {
                onIssueClick(id);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
