import { useState, useRef } from 'react';
import { X, Plus, Paperclip, Image as ImageIcon, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateIssue, useProjects, useTrackers, usePriorities, useProjectMembers } from '../hooks/useRedmine';
import { redmineApi } from '../api/redmine';
import { markdownToTextile } from '../utils/markdownToTextile';
import { getAIKey } from '../utils/aiConfig';

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
  const qc = useQueryClient();

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [trackerId, setTrackerId] = useState<number | ''>('');
  const [priorityId, setPriorityId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState<number | ''>('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [forceCreate, setForceCreate] = useState(false);
  const [intermediateProjectId, setIntermediateProjectId] = useState<number | ''>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: members } = useProjectMembers(projectId || undefined);

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (arr.length) setFiles(f => [...f, ...arr]);
  };
  const removeFile = (i: number) => setFiles(f => f.filter((_, idx) => idx !== i));

  const buildPayload = async (targetProjectId: number) => {
    const uploads = [];
    for (const f of files) {
      try { uploads.push(await redmineApi.uploadFile(f)); }
      catch { throw new Error(`Falha ao enviar o arquivo "${f.name}". Verifique o tamanho (máx 50 MB).`); }
    }
    return {
      subject: subject.trim(),
      project_id: targetProjectId,
      ...(trackerId ? { tracker_id: trackerId as number } : {}),
      ...(priorityId ? { priority_id: priorityId as number } : {}),
      ...(assignedTo ? { assigned_to_id: assignedTo as number } : {}),
      ...(description.trim() ? { description: markdownToTextile(description.trim()) } : {}),
      ...(dueDate ? { due_date: dueDate } : {}),
      ...(uploads.length ? { uploads } : {}),
    };
  };

  const handleAISuggest = async () => {
    if (!subject.trim() || aiSuggesting) return;
    setAiSuggesting(true);
    setAiReasoning(null);
    try {
      const suggestion = await redmineApi.suggestFields(
        subject,
        description,
        trackers?.map(t => ({ id: t.id, name: t.name })) ?? [],
        priorities?.map(p => ({ id: p.id, name: p.name })) ?? [],
      );
      if (suggestion.tracker_id)  setTrackerId(suggestion.tracker_id);
      if (suggestion.priority_id) setPriorityId(suggestion.priority_id);
      if (suggestion.reasoning)   setAiReasoning(suggestion.reasoning);
    } catch {
      setAiReasoning('Não foi possível sugerir campos. Tente novamente.');
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleApiError = (err: any) => {
    const status: number | undefined = err?.response?.status;
    const redmineErrors: string[] = err?.response?.data?.errors;
    if (redmineErrors?.length) return setError(redmineErrors.join('\n'));
    if (status === 403) { setError('Sem permissão para criar tarefas neste projeto.'); setForceCreate(true); return; }
    if (status === 422) return setError('O Redmine rejeitou a tarefa. Verifique os campos obrigatórios do projeto.');
    if (status === 404) return setError('Projeto não encontrado. Tente recarregar a página.');
    if (!navigator.onLine || err?.code === 'ERR_NETWORK') return setError('Sem conexão com o servidor.');
    setError(err?.response?.data?.error ?? err?.message ?? 'Erro desconhecido ao criar a tarefa.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !projectId || uploading || createIssue.isPending) return;
    setError(null);
    setForceCreate(false);
    setUploading(true);
    try {
      await createIssue.mutateAsync(await buildPayload(projectId as number));
      onClose();
    } catch (err: any) {
      handleApiError(err);
    } finally {
      setUploading(false);
    }
  };

  const handleForceCreate = async () => {
    if (!intermediateProjectId || !projectId) return;
    setError(null);
    setForceCreate(false);
    setUploading(true);
    try {
      // Chama a API diretamente para não invalidar o cache entre as duas operações
      const created = await redmineApi.createIssue(await buildPayload(intermediateProjectId as number));
      await redmineApi.updateIssue(created.id, { project_id: projectId });
      // Invalida só depois que a tarefa já está no projeto certo
      await qc.invalidateQueries({ queryKey: ['issues'] });
      onClose();
    } catch (err: any) {
      handleApiError(err);
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
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-700">Título *</label>
              {getAIKey() && (
                <button
                  type="button"
                  onClick={handleAISuggest}
                  disabled={!subject.trim() || aiSuggesting}
                  title="Sugerir tracker e prioridade com IA"
                  className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 disabled:opacity-40 transition-colors"
                >
                  {aiSuggesting
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Sparkles size={11} />}
                  {aiSuggesting ? 'Sugerindo…' : 'Sugerir com IA'}
                </button>
              )}
            </div>
            <input
              type="text"
              value={subject}
              onChange={e => { setSubject(e.target.value); setError(null); setAiReasoning(null); }}
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
                onChange={e => { setProjectId(e.target.value ? Number(e.target.value) : ''); setAssignedTo(''); setError(null); }}
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

          {aiReasoning && (
            <div className="flex items-start gap-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 text-xs text-purple-700">
              <Sparkles size={12} className="mt-0.5 flex-shrink-0" />
              <span>{aiReasoning}</span>
              <button
                type="button"
                onClick={() => setAiReasoning(null)}
                className="ml-auto text-purple-400 hover:text-purple-600 flex-shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          )}

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

          {error && !forceCreate && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700">
              <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
              <p className="whitespace-pre-line">{error}</p>
            </div>
          )}

          {forceCreate && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2.5">
              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertCircle size={13} />
                Sem permissão direta neste projeto.
              </p>
              <p className="text-xs text-amber-700">
                Selecione um projeto intermediário onde você tem permissão de criação.
                A tarefa será criada lá e movida automaticamente para o projeto desejado.
              </p>
              <select
                value={intermediateProjectId}
                onChange={e => setIntermediateProjectId(e.target.value ? Number(e.target.value) : '')}
                className="w-full text-sm border border-amber-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">Selecionar projeto intermediário…</option>
                {projects?.filter(p => p.id !== projectId).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setForceCreate(false); setError(null); }}
                  className="flex-1 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100 rounded-lg transition-colors border border-amber-200"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleForceCreate}
                  disabled={!intermediateProjectId || uploading || createIssue.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {uploading || createIssue.isPending
                    ? <><Loader2 size={12} className="animate-spin" /> Criando…</>
                    : 'Criar e mover automaticamente'}
                </button>
              </div>
            </div>
          )}

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
              {uploading && files.length > 0 ? 'Enviando anexos…' : uploading || createIssue.isPending ? 'Criando…' : 'Criar Tarefa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
