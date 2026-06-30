import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

interface CmdItem {
  title: string;
  keywords: string;
  icon: string;
  command: (p: { editor: Editor; range: Range }) => void;
}

const ITEMS: CmdItem[] = [
  {
    title: 'Título 1',
    keywords: 'h1 titulo heading grande',
    icon: 'H1',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
  },
  {
    title: 'Título 2',
    keywords: 'h2 subtitulo',
    icon: 'H2',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
  },
  {
    title: 'Título 3',
    keywords: 'h3 subtitulo menor',
    icon: 'H3',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
  },
  {
    title: 'Lista',
    keywords: 'lista bullet marcadores',
    icon: '•',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Lista numerada',
    keywords: 'numerada ordenada ordered',
    icon: '1.',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Checklist',
    keywords: 'checklist tarefas todo caixa check',
    icon: '☑',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Citação',
    keywords: 'citacao quote bloco',
    icon: '"',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Código',
    keywords: 'codigo code bloco',
    icon: '</>',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Divisória',
    keywords: 'divisoria linha separador hr',
    icon: '—',
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

// Popup do menu em DOM puro (posicionado pelo clientRect da suggestion)
function makeRenderer() {
  let el: HTMLDivElement | null = null;
  let items: CmdItem[] = [];
  let pick: (item: CmdItem) => void = () => {};
  let selected = 0;

  const paint = () => {
    if (!el) return;
    el.innerHTML = '';
    if (items.length === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `slash-item${i === selected ? ' is-selected' : ''}`;
      const ico = document.createElement('span');
      ico.className = 'slash-ico';
      ico.textContent = item.icon;
      const lbl = document.createElement('span');
      lbl.textContent = item.title;
      btn.append(ico, lbl);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(item);
      });
      el!.appendChild(btn);
    });
  };

  const place = (rectFn?: (() => DOMRect | null) | null) => {
    if (!el || !rectFn) return;
    const r = rectFn();
    if (!r) return;
    el.style.left = `${r.left}px`;
    el.style.top = `${r.bottom + 6}px`;
  };

  return {
    onStart: (props: {
      items: CmdItem[];
      command: (i: CmdItem) => void;
      clientRect?: (() => DOMRect | null) | null;
    }) => {
      items = props.items;
      pick = props.command;
      selected = 0;
      el = document.createElement('div');
      el.className = 'slash-menu';
      document.body.appendChild(el);
      paint();
      place(props.clientRect);
    },
    onUpdate: (props: {
      items: CmdItem[];
      command: (i: CmdItem) => void;
      clientRect?: (() => DOMRect | null) | null;
    }) => {
      items = props.items;
      pick = props.command;
      selected = 0;
      paint();
      place(props.clientRect);
    },
    onKeyDown: (props: { event: KeyboardEvent }) => {
      const k = props.event.key;
      if (k === 'ArrowDown') {
        selected = (selected + 1) % items.length;
        paint();
        return true;
      }
      if (k === 'ArrowUp') {
        selected = (selected - 1 + items.length) % items.length;
        paint();
        return true;
      }
      if (k === 'Enter') {
        if (items[selected]) pick(items[selected]);
        return true;
      }
      if (k === 'Escape') {
        if (el) el.style.display = 'none';
        return true;
      }
      return false;
    },
    onExit: () => {
      el?.remove();
      el = null;
    },
  };
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<CmdItem>({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        command: ({ editor, range, props }) => props.command({ editor, range }),
        items: ({ query }) => {
          const q = query.toLowerCase();
          return ITEMS.filter(
            (i) => i.title.toLowerCase().includes(q) || i.keywords.includes(q),
          ).slice(0, 9);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        render: makeRenderer as any,
      }),
    ];
  },
});
