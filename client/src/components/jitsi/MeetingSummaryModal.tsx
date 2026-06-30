import { useState, useEffect, useRef } from 'react';
import { X, FileText, CheckCircle, Copy, Check, AlertCircle, Loader2 } from 'lucide-react';
import { redmineApi } from '../../api/redmine';
import { Markdown } from '../Markdown';
import type { ActiveCall, PoppedOutCall } from './JitsiContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  audioBlob: Blob | null;
  call: ActiveCall | PoppedOutCall | null;
}

export function MeetingSummaryModal({ isOpen, onClose, audioBlob, call }: Props) {
  const [step, setStep] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [copied, setCopied] = useState(false);
  // Trava de idempotência: garante que cada blob seja transcrito UMA vez, mesmo
  // com o duplo-mount do StrictMode (evita cobrar o Whisper duas vezes).
  const processedBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    if (!isOpen || !audioBlob || !call) return;
    if (processedBlobRef.current === audioBlob) return; // já processado
    processedBlobRef.current = audioBlob;

    let isCancelled = false;

    (async function processAudio() {
      setStep('processing');
      setErrorMsg('');
      setPosted(false);
      try {
        const res = await redmineApi.transcribeSummarize(
          audioBlob,
          `reuniao-${call.room}.webm`,
          call.title,
          '',
        );
        if (isCancelled) return;
        setTranscript(res.transcript);
        setSummary(res.summary);
        setStep('done');
      } catch (err: any) {
        if (isCancelled) return;
        setStep('error');
        let msg = err.response?.data?.error || err.message || 'Erro ao transcrever áudio.';
        if (msg === 'AI_NOT_CONFIGURED') {
          msg =
            'Nenhum provedor de IA configurado. Vá em Configurações (⚙️) -> IA e defina uma chave de API.';
        }
        setErrorMsg(msg);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, audioBlob, call]);

  // Reseta ao fechar
  useEffect(() => {
    if (!isOpen) {
      setStep('idle');
      setTranscript('');
      setSummary('');
      setCopied(false);
      processedBlobRef.current = null;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePostNote = async () => {
    if (!call?.issueId) return;
    setIsPosting(true);
    try {
      const noteContent = `${summary}\n\n---\n**Resumo gerado por IA com base na gravação da chamada.**`;
      await redmineApi.addNote(call.issueId, noteContent);
      setPosted(true);
    } catch (err: any) {
      alert('Erro ao postar nota: ' + err.message);
    } finally {
      setIsPosting(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100 font-semibold">
            <FileText size={18} className="text-blue-500" />
            <span>Resumo da Reunião</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500 dark:text-slate-400">
              <Loader2 size={40} className="animate-spin mb-4 text-blue-500" />
              <p className="text-sm font-medium">Transcrevendo o áudio (Whisper)...</p>
              <p className="text-xs mt-2 opacity-70 max-w-xs text-center">
                Isso pode levar alguns minutos dependendo do tamanho da gravação e qualidade da
                rede.
              </p>
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="bg-red-50 dark:bg-red-500/10 p-4 rounded-full mb-4">
                <AlertCircle size={32} className="text-red-500 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-2">
                Ops, algo deu errado
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md leading-relaxed">
                {errorMsg}
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
                  Ata / Resumo
                </h3>
                <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                  {summary ? (
                    <Markdown
                      text={summary}
                      className="text-sm text-slate-700 dark:text-slate-300"
                    />
                  ) : (
                    <span className="text-sm italic opacity-50">Nenhum resumo gerado.</span>
                  )}
                </div>
              </div>

              {transcript && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
                    Transcrição Bruta
                  </h3>
                  <div className="bg-slate-100 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 h-32 overflow-y-auto font-mono">
                    {transcript}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'done' && (
          <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3 flex-shrink-0">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
              {copied ? 'Copiado!' : 'Copiar'}
            </button>

            {call?.issueId && (
              <button
                onClick={handlePostNote}
                disabled={isPosting || posted}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {posted ? (
                  <CheckCircle size={16} />
                ) : isPosting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <FileText size={16} />
                )}
                {posted ? 'Nota Salva!' : 'Salvar na Tarefa'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
