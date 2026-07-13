import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Markdown } from 'tiptap-markdown';
import { SlashCommand } from './noteSlashCommand';
import { IssueMention } from './noteIssueMention';
import {
  Bold,
  Italic,
  Strikethrough,
  Underline as UnderlineIcon,
  Code,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Baseline,
  Highlighter,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';

// Paletas do modo HTML (notas do Nextcloud): cor de texto e realce.
const TEXT_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const HL_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff'];

interface Props {
  value: string; // conteúdo inicial (markdown, ou HTML quando format='html')
  onChange: (content: string) => void;
  noteId: string; // recarrega o conteúdo ao trocar de nota
  placeholder?: string;
  onIssueClick?: (id: number) => void; // abre tarefa ao clicar em #1234
  editable?: boolean; // false = somente-leitura
  // 'markdown' (padrão): lê/grava markdown (notas locais). 'html': lê/grava HTML e
  // habilita cor de texto/realce (notas do Nextcloud/QuickNotes, que guardam HTML).
  format?: 'markdown' | 'html';
}

/**
 * Editor WYSIWYG estilo Notion: a formatação é renderizada em tempo real enquanto se
 * digita. Em modo 'markdown' o conteúdo é lido/gravado como Markdown (notas locais);
 * em modo 'html' é lido/gravado como HTML e ganha cor de texto/realce (Nextcloud).
 */
export function RichNoteEditor({
  value,
  onChange,
  noteId,
  placeholder = 'Comece a escrever…',
  onIssueClick,
  editable = true,
  format = 'markdown',
}: Props) {
  const isHtml = format === 'html';
  const settingContent = useRef(false);
  const issueClickRef = useRef(onIssueClick);
  issueClickRef.current = onIssueClick;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // Nós de tabela: sem eles o schema não tem onde encaixar uma tabela colada
      // (GFM `| … |`), e o tiptap-markdown — que já traz o serializer/parser de
      // tabela por nome de nó — descartaria o conteúdo. resizable: edição da largura.
      TableKit.configure({ table: { resizable: true } }),
      SlashCommand,
      IssueMention.configure({ onIssueClick: (id) => issueClickRef.current?.(id) }),
      // Modo HTML: cor de texto (TextStyle+Color) e realce; o parse/serialize de
      // string vira HTML nativo do tiptap. Modo markdown: a extensão Markdown.
      ...(isHtml
        ? [TextStyle, Color, Highlight.configure({ multicolor: true })]
        : [
            Markdown.configure({
              html: false,
              linkify: true,
              breaks: true,
              transformPastedText: true,
            }),
          ]),
    ],
    content: value,
    editable,
    editorProps: {
      attributes: { class: 'note-doc focus:outline-none' },
    },
    onUpdate: ({ editor }) => {
      if (settingContent.current) return;
      if (isHtml) {
        onChange(editor.getHTML());
      } else {
        const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } };
        onChange(storage.markdown.getMarkdown());
      }
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
          <NoteBubbleMenu editor={editor} showColor={isHtml} />
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </>
  );
}

// Barra flutuante que aparece ao selecionar texto (estilo Notion). `showColor`
// habilita os controles de cor de texto/realce/sublinhado (modo HTML — Nextcloud).
function NoteBubbleMenu({ editor, showColor }: { editor: Editor; showColor?: boolean }) {
  const Btn = ({
    onClick,
    active,
    title,
    children,
  }: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
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
      <Btn
        title="Negrito (Ctrl+B)"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={14} />
      </Btn>
      <Btn
        title="Itálico (Ctrl+I)"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={14} />
      </Btn>
      <Btn
        title="Tachado"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={14} />
      </Btn>
      <Btn
        title="Código"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={14} />
      </Btn>

      <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-0.5" />

      <Btn
        title="Título 1"
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 size={14} />
      </Btn>
      <Btn
        title="Título 2"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={14} />
      </Btn>
      <Btn
        title="Lista"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={14} />
      </Btn>
      <Btn
        title="Lista numerada"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={14} />
      </Btn>
      <Btn
        title="Citação"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={14} />
      </Btn>

      {showColor && (
        <>
          <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-0.5" />
          <Btn
            title="Sublinhado (Ctrl+U)"
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon size={14} />
          </Btn>
          {/* Cor do texto */}
          <div className="flex items-center gap-0.5 px-1">
            <Baseline size={13} className="text-slate-400 flex-shrink-0" />
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={`Cor ${c}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().setColor(c).run();
                }}
                style={{ backgroundColor: c }}
                className="w-3.5 h-3.5 rounded-full border border-black/10 hover:scale-125 transition-transform"
              />
            ))}
            <button
              type="button"
              title="Sem cor"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().unsetColor().run();
              }}
              className="text-[11px] leading-none text-slate-400 hover:text-slate-600 px-0.5"
            >
              ✕
            </button>
          </div>
          {/* Realce */}
          <div className="flex items-center gap-0.5 px-1">
            <Highlighter size={13} className="text-slate-400 flex-shrink-0" />
            {HL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={`Realce ${c}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().toggleHighlight({ color: c }).run();
                }}
                style={{ backgroundColor: c }}
                className="w-3.5 h-3.5 rounded-sm border border-black/10 hover:scale-125 transition-transform"
              />
            ))}
            <button
              type="button"
              title="Sem realce"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().unsetHighlight().run();
              }}
              className="text-[11px] leading-none text-slate-400 hover:text-slate-600 px-0.5"
            >
              ✕
            </button>
          </div>
        </>
      )}
    </div>
  );
}
