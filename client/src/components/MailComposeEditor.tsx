import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Node, mergeAttributes } from '@tiptap/core';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link2,
  Image as ImageIcon,
} from 'lucide-react';

// Nó de imagem mínimo (sem @tiptap/extension-image, que não está instalado).
// Permite logo/imagem no rodapé via URL ou data URI. Bloco simples com src/alt.
const MailImage = Node.create({
  name: 'image',
  group: 'block',
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      width: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { style: 'max-width:100%' })];
  },
});

interface Props {
  value: string; // HTML inicial
  onChange: (html: string) => void;
  /** Bump para recarregar o conteúdo a partir de `value` (template/assinatura). */
  resetSignal?: number;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
}

/**
 * Editor rico (WYSIWYG) para compor e-mail — produz HTML via editor.getHTML().
 * Reaproveita o TipTap já presente no projeto. StarterKit v3 já traz Link e
 * Underline; a imagem usa um nó local mínimo (ver MailImage).
 */
export function MailComposeEditor({
  value,
  onChange,
  resetSignal = 0,
  placeholder = 'Escreva sua mensagem…',
  minHeight = 220,
  autoFocus,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
      Placeholder.configure({ placeholder }),
      MailImage,
    ],
    content: value,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'mail-compose-doc focus:outline-none',
        style: `min-height:${minHeight}px`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Recarrega o conteúdo quando o pai troca `value` intencionalmente
  // (escolher template / semear assinatura). setContent dispara onUpdate de
  // forma síncrona, então também propagamos o novo HTML.
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(value || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal, editor]);

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      {editor && <Toolbar editor={editor} />}
      <div className="px-3 py-2 text-sm text-slate-800 dark:text-slate-100 overflow-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
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
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300'
          : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );

  const promptLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL do link:', prev || 'https://');
    if (url === null) return; // cancelou
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const promptImage = () => {
    const url = window.prompt('URL da imagem:');
    if (!url) return;
    editor
      .chain()
      .focus()
      .insertContent({ type: 'image', attrs: { src: url } })
      .run();
  };

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
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
        title="Sublinhado (Ctrl+U)"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon size={14} />
      </Btn>
      <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-0.5" />
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
      <span className="w-px h-5 bg-slate-200 dark:bg-slate-600 mx-0.5" />
      <Btn title="Link" active={editor.isActive('link')} onClick={promptLink}>
        <Link2 size={14} />
      </Btn>
      <Btn title="Imagem" onClick={promptImage}>
        <ImageIcon size={14} />
      </Btn>
    </div>
  );
}
