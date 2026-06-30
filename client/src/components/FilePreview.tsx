import { useState, useEffect, useRef } from 'react';
import {
  X,
  Download,
  ExternalLink,
  Loader2,
  Archive,
  Folder,
  File,
  FileText,
  Image as ImageIcon,
  Music,
  Video as VideoIcon,
  FileCode,
  FileSpreadsheet,
} from 'lucide-react';

// Visualizador de arquivos reutilizável (Drive e Talk). Recebe uma função `load`
// que devolve o conteúdo como Blob — assim cada contexto usa seu próprio endpoint.

export interface PreviewFile {
  name: string;
  mime?: string;
  ncFileId?: string;
}

function ext(name: string) {
  return (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
}

function formatBytes(n: number): string {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function Glyph({
  name,
  size = 22,
  isDir = false,
}: {
  name: string;
  size?: number;
  isDir?: boolean;
}) {
  if (isDir) return <Folder size={size} className="text-blue-400" />;
  const e = ext(name);
  if (/^(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(e))
    return <ImageIcon size={size} className="text-emerald-500" />;
  if (/^(mp3|wav|ogg|oga|opus|m4a|aac)$/.test(e))
    return <Music size={size} className="text-pink-500" />;
  if (/^(mp4|webm|mov|mkv|avi|m4v)$/.test(e))
    return <VideoIcon size={size} className="text-purple-500" />;
  if (/^(zip|rar|7z|tar|gz)$/.test(e)) return <Archive size={size} className="text-amber-500" />;
  if (/^(pdf|docx?|txt|rtf|odt)$/.test(e)) return <FileText size={size} className="text-red-500" />;
  if (/^(xlsx?|csv|ods)$/.test(e))
    return <FileSpreadsheet size={size} className="text-green-600" />;
  if (/^(js|ts|tsx|jsx|json|html|css|py|java|c|cpp|sh|xml|yml|yaml)$/.test(e))
    return <FileCode size={size} className="text-sky-500" />;
  return <File size={size} className="text-slate-400" />;
}

type PreviewKind =
  | 'image'
  | 'pdf'
  | 'text'
  | 'audio'
  | 'video'
  | 'zip'
  | 'drawio'
  | 'sheet'
  | 'none';
export function previewKind(name: string, mime = ''): PreviewKind {
  const m = mime;
  const x = ext(name);
  if (x === 'drawio') return 'drawio';
  if (m.startsWith('image/') || /^(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(x)) return 'image';
  if (m === 'application/pdf' || x === 'pdf') return 'pdf';
  if (m.startsWith('audio/') || /^(mp3|wav|ogg|oga|opus|m4a|aac)$/.test(x)) return 'audio';
  if (m.startsWith('video/') || /^(mp4|webm|mov|mkv|avi|m4v)$/.test(x)) return 'video';
  if (x === 'zip' || m === 'application/zip' || m === 'application/x-zip-compressed') return 'zip';
  if (
    /^(csv|xlsx|xls)$/.test(x) ||
    m === 'text/csv' ||
    m.includes('spreadsheet') ||
    m.includes('ms-excel')
  )
    return 'sheet';
  if (
    m.startsWith('text/') ||
    /^(txt|md|markdown|log|json|js|ts|tsx|jsx|css|scss|html|xml|yml|yaml|sh|bash|py|java|c|cpp|h|hpp|ini|conf|env|sql|php|rb|go|rs|toml)$/.test(
      x,
    )
  )
    return 'text';
  return 'none';
}

// True se a extensão/mime indicam algo que o visualizador consegue mostrar.
export function isPreviewable(name: string, mime = ''): boolean {
  return previewKind(name, mime) !== 'none';
}

interface ZipEntry {
  name: string;
  dir: boolean;
  size: number;
}
interface SheetTab {
  name: string;
  rows: string[][];
}

function parseCsv(text: string): string[][] {
  const head = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const cand: Array<[string, number]> = [
    [',', (head.match(/,/g) || []).length],
    [';', (head.match(/;/g) || []).length],
    ['\t', (head.match(/\t/g) || []).length],
  ];
  cand.sort((a, b) => b[1] - a[1]);
  const delim = cand[0][1] > 0 ? cand[0][0] : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function FallbackPreview({
  name,
  hasNc,
  onDownload,
  onOpenNc,
}: {
  name: string;
  hasNc: boolean;
  onDownload: () => void;
  onOpenNc: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 text-white/85"
      onClick={(e) => e.stopPropagation()}
    >
      <Glyph name={name} size={56} />
      <p className="text-sm">Pré-visualização não disponível para este tipo de arquivo.</p>
      <div className="flex gap-2">
        {hasNc && (
          <button
            onClick={onOpenNc}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs"
          >
            <ExternalLink size={13} /> Abrir no Nextcloud
          </button>
        )}
        <button
          onClick={onDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs"
        >
          <Download size={13} /> Baixar
        </button>
      </div>
    </div>
  );
}

function DrawioPreview({ xml }: { xml: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      let msg: { event?: string };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.event === 'init')
        ref.current?.contentWindow?.postMessage(
          JSON.stringify({ action: 'load', xml, autosave: 0 }),
          '*',
        );
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [xml]);
  return (
    <iframe
      ref={ref}
      title="draw.io"
      src="https://viewer.diagrams.net/?embed=1&proto=json&spin=1&libraries=0&noSaveBtn=1&noExitBtn=1&lightbox=1"
      className="w-full h-full bg-white rounded-lg"
    />
  );
}

export function FilePreviewModal({
  file,
  load,
  onClose,
  onDownload,
  ncUrl,
}: {
  file: PreviewFile;
  load: () => Promise<Blob>;
  onClose: () => void;
  onDownload: () => void;
  ncUrl?: string;
}) {
  const kind = previewKind(file.name, file.mime);
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [zip, setZip] = useState<ZipEntry[] | null>(null);
  const [sheets, setSheets] = useState<SheetTab[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [err, setErr] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (kind === 'none') return;
    let active = true;
    load()
      .then(async (blob) => {
        if (!active) return;
        if (kind === 'text' || kind === 'drawio') {
          if (kind === 'text' && blob.size > 2_000_000) {
            setErr(true);
            return;
          }
          setText(await blob.text());
        } else if (kind === 'zip') {
          const mod = (await import('jszip')) as unknown as { default?: typeof import('jszip') };
          const JSZip = mod.default ?? (mod as unknown as typeof import('jszip'));
          const z = await JSZip.loadAsync(blob);
          const list: ZipEntry[] = Object.values(z.files)
            .map((f) => ({
              name: f.name.replace(/\/$/, ''),
              dir: f.dir,
              size:
                (f as unknown as { _data?: { uncompressedSize?: number } })._data
                  ?.uncompressedSize ?? 0,
            }))
            .filter((e) => e.name);
          list.sort((a, b) =>
            a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, 'pt'),
          );
          if (active) setZip(list);
        } else if (kind === 'sheet') {
          if (ext(file.name) === 'csv') {
            if (active) setSheets([{ name: 'CSV', rows: parseCsv(await blob.text()) }]);
          } else {
            const XLSX = await import('xlsx');
            const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
            const tabs: SheetTab[] = wb.SheetNames.map((n) => ({
              name: n,
              rows: (
                XLSX.utils.sheet_to_json(wb.Sheets[n], {
                  header: 1,
                  blankrows: false,
                  defval: '',
                }) as unknown[][]
              ).map((r) => r.map((c) => (c == null ? '' : String(c)))),
            }));
            if (active) setSheets(tabs);
          }
        } else {
          const u = URL.createObjectURL(blob);
          urlRef.current = u;
          setUrl(u);
        }
      })
      .catch((e) => {
        console.error('[file preview] erro:', kind, e);
        if (active) setErr(true);
      });
    return () => {
      active = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [file.name]);

  const openInNc = () => {
    if (ncUrl && file.ncFileId)
      window.open(`${ncUrl}/index.php/f/${file.ncFileId}`, '_blank', 'noopener');
  };
  const loading =
    !err &&
    kind !== 'none' &&
    (kind === 'text' || kind === 'drawio'
      ? text === null
      : kind === 'zip'
        ? zip === null
        : kind === 'sheet'
          ? sheets === null
          : url === null);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/85" onClick={onClose}>
      <div
        className="flex items-center gap-3 px-4 py-3 text-white flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Glyph name={file.name} size={18} />
        <span className="flex-1 truncate text-sm">{file.name}</span>
        {ncUrl && file.ncFileId && (
          <button
            onClick={openInNc}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs"
          >
            <ExternalLink size={13} /> Abrir no Nextcloud
          </button>
        )}
        <button
          onClick={onDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs"
        >
          <Download size={13} /> Baixar
        </button>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center flex-shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div
        className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && <Loader2 size={30} className="animate-spin text-white/70" />}
        {(err || kind === 'none') && (
          <FallbackPreview
            name={file.name}
            hasNc={!!(ncUrl && file.ncFileId)}
            onDownload={onDownload}
            onOpenNc={openInNc}
          />
        )}
        {!loading && !err && kind === 'image' && url && (
          <img
            src={url}
            alt={file.name}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        )}
        {!loading && !err && kind === 'pdf' && url && (
          <iframe src={url} title={file.name} className="w-full h-full bg-white rounded-lg" />
        )}
        {!loading && !err && kind === 'video' && url && (
          <video
            src={url}
            controls
            autoPlay
            className="max-w-full max-h-full rounded-lg shadow-2xl"
          />
        )}
        {!loading && !err && kind === 'audio' && url && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-[min(90vw,440px)] flex flex-col items-center gap-3">
            <Glyph name={file.name} size={40} />
            <audio src={url} controls autoPlay className="w-full" />
          </div>
        )}
        {!loading && !err && kind === 'text' && text !== null && (
          <pre className="w-full max-w-4xl max-h-full overflow-auto bg-slate-900 text-slate-100 text-xs rounded-lg p-4 whitespace-pre-wrap break-words font-mono shadow-2xl">
            {text}
          </pre>
        )}
        {!loading && !err && kind === 'drawio' && text !== null && (
          <div className="w-full h-full">
            <DrawioPreview xml={text} />
          </div>
        )}
        {!loading && !err && kind === 'zip' && zip && (
          <div className="w-full max-w-2xl max-h-full flex flex-col bg-white dark:bg-slate-900 rounded-xl overflow-hidden shadow-2xl">
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <Archive size={16} className="text-amber-500" />
              <span className="text-sm font-semibold flex-1 truncate">{file.name}</span>
              <span className="text-[11px] text-slate-400">
                {zip.filter((z) => !z.dir).length} arquivo(s)
              </span>
            </div>
            <div className="overflow-y-auto scrollbar-thin">
              {zip.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">Zip vazio</p>
              )}
              {zip.map((z) => (
                <div
                  key={z.name}
                  className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-50 dark:border-slate-800/50 last:border-0"
                >
                  {z.dir ? (
                    <Folder size={16} className="text-blue-400 flex-shrink-0" />
                  ) : (
                    <Glyph name={z.name} size={16} />
                  )}
                  <span
                    className="flex-1 text-xs text-slate-700 dark:text-slate-200 truncate"
                    title={z.name}
                  >
                    {z.name}
                  </span>
                  {!z.dir && z.size > 0 && (
                    <span className="text-[10px] text-slate-400 flex-shrink-0">
                      {formatBytes(z.size)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {!loading &&
          !err &&
          kind === 'sheet' &&
          sheets &&
          (() => {
            const tab = sheets[Math.min(activeSheet, sheets.length - 1)] ?? { name: '', rows: [] };
            const rows = tab.rows;
            const head = rows[0] ?? [];
            const body = rows.slice(1, 1001);
            return (
              <div className="w-full max-w-6xl max-h-full flex flex-col bg-white dark:bg-slate-900 rounded-xl overflow-hidden shadow-2xl">
                {sheets.length > 1 && (
                  <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-thin flex-shrink-0">
                    {sheets.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveSheet(i)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${i === activeSheet ? 'bg-blue-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="overflow-auto scrollbar-thin">
                  <table className="text-xs border-collapse w-full">
                    {head.length > 0 && (
                      <thead className="sticky top-0">
                        <tr>
                          <th className="bg-slate-100 dark:bg-slate-800 text-slate-400 font-normal px-2 py-1 border border-slate-200 dark:border-slate-700 sticky left-0 z-10">
                            #
                          </th>
                          {head.map((c, i) => (
                            <th
                              key={i}
                              className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 text-left whitespace-nowrap"
                            >
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {body.map((r, ri) => (
                        <tr key={ri} className="even:bg-slate-50/50 dark:even:bg-slate-800/30">
                          <td className="text-slate-300 dark:text-slate-600 px-2 py-1 border border-slate-100 dark:border-slate-800 text-right sticky left-0 bg-white dark:bg-slate-900">
                            {ri + 2}
                          </td>
                          {head.map((_, ci) => (
                            <td
                              key={ci}
                              className="text-slate-700 dark:text-slate-300 px-2.5 py-1 border border-slate-100 dark:border-slate-800 whitespace-nowrap max-w-[280px] truncate"
                              title={r[ci] ?? ''}
                            >
                              {r[ci] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-3 py-1.5 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 flex-shrink-0">
                  {rows.length} linha(s){rows.length > 1001 ? ' · mostrando as primeiras 1000' : ''}
                </div>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
