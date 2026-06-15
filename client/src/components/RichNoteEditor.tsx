import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { SlashCommand } from './noteSlashCommand';
import { IssueMention } from './noteIssueMention';
import { Bold, Italic, Strikethrough, Code, Heading1, Heading2, List, ListOrdered, Quote } from 'lucide-react';
import type { Editor } from '@tiptap/react';

interface Props {
  value: string;            // markdown inicial
  onChange: (markdown: string) => void;
  noteId: string;           // recarrega o conteúdo ao trocar de nota
  placeholder?: string;
  onIssueClick?: (id: number) => void;  // abre tarefa ao clicar em #1234
}

/**
 * Editor WYSIWYG estilo Notion: a formatação Markdown é renderizada em tempo real
 * enquanto se digita (## vira título, - vira lista, **x** vira negrito…). O
 * conteúdo é lido/gravado como Markdown, mantendo compatibilidade com o resto do app.
 */
export function RichNoteEditor({ value, onChange, noteId, placeholder = 'Comece a escrever…', onIssueClick }: Props) {
  const settingContent = useRef(false);
  const issueClickRef = useRef(onIssueClick);
  issueClickRef.current = onIssueClick;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      SlashCommand,
      IssueMention.configure({ onIssueClick: (id) => issueClickRef.current?.(id) }),
      Markdown.configure({ html: false, linkify: true, breaks: true, transformPastedText: true }),
    ],
    content: value,
    editorProps: {
      attributes: { class: 'note-doc focus:outline-none' },
    },
    onUpdate: ({ editor }) => {
      if (settingContent.current) return;
      const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } };
      onChange(storage.markdown.getMarkdown());
    },
  });

  // Troca de nota → recarrega o conteúdo sem disparar onChange (guard via ref:
  // setContent dispara onUpdate de forma síncrona, então o flag o intercepta)
  useEffect(() => {
    if (!editor) return;
    settingContent.current = true;
    editor.commands.setContent(value);
    settingContent.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, editor]);

  return (
    <>
      {editor && (
        <BubbleMenu editor={editor}>
          <NoteBubbleMenu editor={editor} />
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </>
  );
}

// Barra flutuante que aparece ao selecionar texto (estilo Notion)
function NoteBubbleMenu({ editor }: { editor: Editor }) {
  const Btn = ({ onClick, active, title, children }: {
    onClick: () => void; active?: boolean; title: string; children: React.ReactNode;
  }) => (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300'
          : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-1">
      <Btn title="Negrito (Ctrl+B)" active={editor.isActive('bold')}
           onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></Btn>
      <Btn title="Itálico (Ctrl+I)" active={editor.isActive('italic')}
           onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></Btn>
      <Btn title="Tachado" active={editor.isActive('strike')}
           onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={14} /></Btn>
      <Btn title="Código" active={editor.isActive('code')}
           onClick={() => editor.chain().focus().toggleCode().run()}><Code size={14} /></Btn>

      <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-0.5" />

      <Btn title="Título 1" active={editor.isActive('heading', { level: 1 })}
           onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={14} /></Btn>
      <Btn title="Título 2" active={editor.isActive('heading', { level: 2 })}
           onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={14} /></Btn>
      <Btn title="Lista" active={editor.isActive('bulletList')}
           onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></Btn>
      <Btn title="Lista numerada" active={editor.isActive('orderedList')}
           onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={14} /></Btn>
      <Btn title="Citação" active={editor.isActive('blockquote')}
           onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={14} /></Btn>
    </div>
  );
}
