import { useState, useRef } from 'react';
import { X, Plus, Paperclip, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useCreateIssue, useProjects, useTrackers, usePriorities, useProjectMembers } from '../hooks/useRedmine';
import { redmineApi } from '../api/redmine';
import { markdownToTextile } from '../utils/markdownToTextile';

interface Props {
  onClose: () => void;
  defaultStatusId?: number;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function CreateIssueModal({ onClose }: Props) {
  const { data: projects } = useProjects();
  const { data: trackers } = useTrackers();
  const { data: priorities } = usePriorities();
  const createIssue = useCreateIssue();

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [trackerId, setTrackerId] = useState<number | ''>('');
  const [priorityId, setPriorityId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState<number | ''>('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: members } = useProjectMembers(projectId || undefined);

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (arr.length) setFiles(f => [...f, ...arr]);
  };
  const removeFile = (i: number) => setFiles(f => f.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !projectId || uploading || createIssue.isPending) return;

    setUploading(true);
    try {
      const uploads = [];
      for (const f of files) uploads.push(await redmineApi.uploadFile(f));
      await createIssue.mutateAsync({
        subject: subject.trim(),
        project_id: projectId as number,
        ...(trackerId ? { tracker_id: trackerId as number } : {}),
        ...(priorityId ? { priority_id: priorityId as number } : {}),
        ...(assignedTo ? { assigned_to_id: assignedTo as number } : {}),
        ...(description.trim() ? { description: markdownToTextile(description.trim()) } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(uploads.length ? { uploads } : {}),
      });
      onClose();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Nova Tarefa</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Título *</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Descreva brevemente a tarefa..."
              required
              autoFocus
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Projeto *</label>
              <select
                value={projectId}
                onChange={e => { setProjectId(e.target.value ? Number(e.target.value) : ''); setAssignedTo(''); }}
                required
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Selecionar...</option>
                {projects?.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Tracker</label>
              <select
                value={trackerId}
                onChange={e => setTrackerId(e.target.value ? Number(e.target.value) : '')}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Padrão</option>
                {trackers?.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Prioridade</label>
              <select
                value={priorityId}
                onChange={e => setPriorityId(e.target.value ? Number(e.target.value) : '')}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Padrão</option>
                {priorities?.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Prazo</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Atribuído para</label>
            <select
              value={assignedTo}
              onChange={e => setAssignedTo(e.target.value ? Number(e.target.value) : '')}
              disabled={!projectId}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">{projectId ? 'Ninguém' : 'Selecione um projeto primeiro'}</option>
              {members?.map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.team ? ` · ${m.team}` : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-700">Descrição</label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600"
              >
                <Paperclip size={13} /> Anexar
              </button>
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
              onPaste={e => {
                const imgs = Array.from(e.clipboardData.items)
                  .filter(i => i.type.startsWith('image/'))
                  .map(i => i.getAsFile())
                  .filter((f): f is File => !!f);
                if (imgs.length) { e.preventDefault(); addFiles(imgs); }
              }}
              placeholder="Detalhes opcionais… (arraste ou cole imagens para anexar)"
              rows={3}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {files.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 rounded-md pl-2 pr-1 py-1">
                    {f.type.startsWith('image/') ? <ImageIcon size={12} /> : <Paperclip size={12} />}
                    <span className="max-w-40 truncate">{f.name}</span>
                    <span className="text-slate-400">{fmtSize(f.size)}</span>
                    <button type="button" onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500 ml-0.5">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createIssue.isPending || uploading || !subject.trim() || !projectId}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {uploading || createIssue.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              {uploading ? 'Enviando anexos…' : createIssue.isPending ? 'Criando...' : 'Criar Tarefa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
