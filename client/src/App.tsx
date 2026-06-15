import { useState, useRef, useEffect, useMemo } from 'react';
import {
  useCurrentUser, useProjects, useMonitoredIssues, useAuthoredIssues,
  useWatchedIssues, useIssues, useToReviewIssues,
} from './hooks/useRedmine';
import { KanbanBoard } from './components/KanbanBoard';
import { IssueListView } from './components/IssueListView';
import { IssueModal } from './components/IssueModal';
import { Dashboard } from './components/Dashboard';
import { PeopleView } from './components/PeopleView';
import { CalendarView } from './components/CalendarView';
import { InboxView } from './components/InboxView';
import { CommandPalette } from './components/CommandPalette';
import { TeamView } from './components/TeamView';
import { ReleaseView } from './components/ReleaseView';
import { CreateIssueModal } from './components/CreateIssueModal';
import { localWatches, useLocalWatches } from './utils/localWatches';
import { Login } from './components/Login';
import { GlobalSearch } from './components/GlobalSearch';
import { getStoredAuth, clearAuth } from './api/redmine';
import { getAIKey } from './utils/aiConfig';
import { useActivityNotifications } from './hooks/useActivityNotifications';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useBrowserNotifications } from './hooks/useBrowserNotifications';
import { useTheme } from './hooks/useTheme';
import { useShortcuts } from './hooks/useShortcuts';
import { SettingsModal } from './components/SettingsModal';
import { StandupModal } from './components/StandupModal';
import { TalkChat } from './components/TalkChat';
import { NotesView } from './components/NotesView';
import type { NotePatch } from './api/notes';
import { LayoutGrid, Gem, ChevronDown, Eye, PenLine, LogOut, Bell, BellOff, X, BarChart3, Star, Sun, Moon, Users, CalendarDays, ClipboardCheck, Inbox, Plus, FlaskConical, GitMerge, Rocket, Settings, Sparkles, NotebookPen } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Issue } from './types/redmine';

type Tab = 'inbox' | 'dashboard' | 'kanban' | 'calendar' | 'review' | 'test' | 'integrate' | 'monitoring' | 'authored' | 'watched' | 'people' | 'team' | 'release' | 'notes';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getStoredAuth());
  const qc = useQueryClient();

  if (!isAuthenticated) {
    return <Login onSuccess={() => setIsAuthenticated(true)} />;
  }

  return <AuthenticatedApp onLogout={() => {
    clearAuth();
    qc.clear();
    setIsAuthenticated(false);
  }} />;
}

function AuthenticatedApp({ onLogout }: { onLogout: () => void }) {
  const { data: user } = useCurrentUser();
  const { data: projects } = useProjects();
  const issuesQuery = useIssues();
  const allIssues = issuesQuery.data;
  const toTest = (allIssues ?? []).filter(i => i.status.id === 44);       // Pendente Teste
  const toIntegrate = (allIssues ?? []).filter(i => i.status.id === 35);  // Pendente Integração
  const [selectedProject, setSelectedProject] = useState<number | undefined>(undefined);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('kanban');
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const watchedIds = useLocalWatches();
  const notifRef = useRef<HTMLDivElement>(null);

  const { focusedIssueId } = useShortcuts({
    activeTab,
    setActiveTab: setActiveTab as (tab: string) => void,
    onOpenIssue: setSelectedIssueId,
    onOpenPalette: () => setPaletteOpen(o => !o),
    paletteOpen,
    modalOpen: !!selectedIssueId,
  });

  const { theme, toggle: toggleTheme } = useTheme();
  const monitored = useMonitoredIssues();
  const authored = useAuthoredIssues();
  const watched = useWatchedIssues();
  const toReview = useToReviewIssues();

  // Contador do Inbox = para revisar + minhas que pedem ação (correção/desenvolver/andamento)
  const inboxCount = (toReview.data?.length ?? 0) + (allIssues ?? []).filter(i => {
    const n = i.status.name.toLowerCase();
    const closed = n.includes('fechad') || n.includes('cancelad');
    return !closed && [34, 32, 8].includes(i.status.id);
  }).length;

  // Atividade = tarefas onde espero resposta de outros (monitoradas + observadas)
  const activityIssues = useMemo(() => {
    const map = new Map<number, Issue>();
    [...(monitored.data ?? []), ...(watched.data ?? [])].forEach(i => map.set(i.id, i));
    return [...map.values()];
  }, [monitored.data, watched.data]);

  const { notifications, dismiss, dismissAll } = useActivityNotifications(allIssues, activityIssues, toReview.data, user?.id);

  // Permissão de notificação — exposta para o botão "Ativar" no navbar.
  const { permission: notifPermission, requestPermission } = useBrowserNotifications();

  const [showSettings, setShowSettings] = useState(false);
  const [showStandup, setShowStandup] = useState(false);

  // Captura rápida de nota / nova nota a partir de uma tarefa
  const [noteSeed, setNoteSeed] = useState<{ nonce: number; patch: NotePatch } | null>(null);
  const openNewNote = (patch: NotePatch = {}) => {
    setNoteSeed({ nonce: Date.now(), patch });
    setActiveTab('notes');
  };

  // Inscreve para Web Push (notificações com a aba fechada).
  usePushNotifications();

  const [pendingTalkToken, setPendingTalkToken] = useState<string | null>(null);

  // Abre tarefa ou sala do Talk ao clicar numa notificação push.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const issueParam   = params.get('issue');
    const talkParam    = params.get('talkRoom');
    if (issueParam)  setSelectedIssueId(Number(issueParam));
    if (talkParam)   setPendingTalkToken(talkParam);
    if (issueParam || talkParam) window.history.replaceState({}, '', '/');

    if (!('serviceWorker' in navigator)) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'open-issue' && e.data.issueId)   setSelectedIssueId(Number(e.data.issueId));
      if (e.data?.type === 'open-talk'  && e.data.talkToken) setPendingTalkToken(e.data.talkToken);
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedProjectName = projects?.find(p => p.id === selectedProject)?.name ?? 'Todos os projetos';

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'inbox',      label: 'Aguardando você', icon: <Inbox size={14} />,   count: inboxCount },
    { id: 'dashboard',  label: 'Dashboard',       icon: <BarChart3 size={14} /> },
    { id: 'kanban',     label: 'Minhas Tarefas',  icon: <LayoutGrid size={14} /> },
    { id: 'calendar',   label: 'Calendário',      icon: <CalendarDays size={14} /> },
    { id: 'review',     label: 'Para revisar',    icon: <ClipboardCheck size={14} />, count: toReview.data?.length },
    ...(toTest.length ? [{ id: 'test' as Tab, label: 'Para testar', icon: <FlaskConical size={14} />, count: toTest.length }] : []),
    ...(toIntegrate.length ? [{ id: 'integrate' as Tab, label: 'Para integrar', icon: <GitMerge size={14} />, count: toIntegrate.length }] : []),
    { id: 'monitoring', label: 'Monitoramento',   icon: <Eye size={14} />,    count: monitored.data?.length },
    { id: 'authored',   label: 'Criadas por mim', icon: <PenLine size={14} />, count: authored.data?.length },
    { id: 'watched',    label: 'Observadas',      icon: <Star size={14} />,   count: watched.data?.length },
    { id: 'people',     label: 'Pessoas',         icon: <Users size={14} /> },
    { id: 'team',       label: 'Time',            icon: <Users size={14} /> },
    { id: 'release',    label: 'Release',         icon: <Rocket size={14} /> },
    { id: 'notes',      label: 'Notas',           icon: <NotebookPen size={14} /> },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-shrink-0 gap-4">
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center">
            <Gem size={16} className="text-white" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-bold text-slate-900">Bluemine</h1>
            <p className="text-xs text-slate-400">b2click.com</p>
          </div>
        </div>

        {/* Busca global */}
        <GlobalSearch onSelectIssue={setSelectedIssueId} />

        <div className="flex items-center gap-3 flex-shrink-0">
          {activeTab === 'kanban' && (
            <div className="relative">
              <button
                onClick={() => setShowProjectMenu(!showProjectMenu)}
                className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors max-w-44 truncate"
              >
                <span className="truncate">{selectedProjectName}</span>
                <ChevronDown size={14} className="flex-shrink-0" />
              </button>
              {showProjectMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 min-w-52 py-1 max-h-80 overflow-y-auto scrollbar-thin">
                  <button
                    onClick={() => { setSelectedProject(undefined); setShowProjectMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${!selectedProject ? 'font-medium text-blue-600' : 'text-slate-700'}`}
                  >
                    Todos os projetos
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  {projects?.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProject(p.id); setShowProjectMenu(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${selectedProject === p.id ? 'font-medium text-blue-600' : 'text-slate-700'}`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Toggle tema */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 hover:text-slate-700"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Ativar notificações — só aparece quando a permissão não foi concedida.
              O clique é o gesto do usuário exigido pelos navegadores modernos. */}
          {notifPermission !== 'granted' && 'Notification' in window && (
            <button
              onClick={requestPermission}
              title={notifPermission === 'denied'
                ? 'Notificações bloqueadas — desbloqueie nas configurações do navegador'
                : 'Ativar notificações'}
              disabled={notifPermission === 'denied'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                notifPermission === 'denied'
                  ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                  : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              <BellOff size={13} />
              {notifPermission === 'denied' ? 'Notificações bloqueadas' : 'Ativar notificações'}
            </button>
          )}

          {/* Sino de notificações */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifications(v => !v)}
              className="relative p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 hover:text-slate-700"
              title="Notificações"
            >
              <Bell size={18} />
              {notifications.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {notifications.length > 9 ? '9+' : notifications.length}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <span className="text-sm font-semibold text-slate-800">
                    {notifications.length === 0 ? 'Sem novidades' : `${notifications.length} notificaç${notifications.length !== 1 ? 'ões' : 'ão'}`}
                  </span>
                  {notifications.length > 0 && (
                    <button onClick={dismissAll} className="text-xs text-slate-400 hover:text-slate-600">
                      Limpar tudo
                    </button>
                  )}
                </div>

                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                    <Bell size={28} className="mb-2 opacity-30" />
                    <p className="text-sm">Tudo em dia!</p>
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto scrollbar-thin">
                    {notifications.map(n => (
                      <div
                        key={n.id}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 group"
                      >
                        <span className={`mt-1 flex-shrink-0 ${n.type === 'assigned' ? 'text-blue-500' : n.type === 'review' ? 'text-violet-500' : 'text-purple-500'}`}>
                          {n.type === 'assigned' ? <LayoutGrid size={14} /> : n.type === 'review' ? <ClipboardCheck size={14} /> : <Bell size={14} />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <button
                            className="text-left w-full"
                            onClick={() => { setSelectedIssueId(n.issue.id); setShowNotifications(false); dismiss(n.id); }}
                          >
                            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                              {n.type === 'assigned' ? 'Atribuída a você' : n.type === 'review' ? 'Pedido de revisão' : 'Nova atividade'}
                            </p>
                            <p className="text-xs font-semibold text-blue-600 hover:underline truncate mt-0.5">
                              #{n.issue.id} — {n.issue.subject}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {formatDistanceToNow(n.seenAt, { addSuffix: true, locale: ptBR })}
                            </p>
                          </button>
                        </div>
                        <button
                          onClick={() => dismiss(n.id)}
                          className="text-slate-300 hover:text-slate-500 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Standup — só aparece quando AI está configurada */}
          {getAIKey() && (
            <button
              onClick={() => setShowStandup(true)}
              title="Gerar daily standup com IA"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 border border-purple-200 dark:border-purple-700 rounded-lg transition-colors"
            >
              <Sparkles size={13} />
              <span className="hidden sm:inline">Standup</span>
            </button>
          )}

          {/* Avatar + Configurações + Logout */}
          {user && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
                {user.firstname.charAt(0)}{user.lastname.charAt(0)}
              </div>
              <span className="text-sm text-slate-600 hidden lg:block">
                {user.firstname} {user.lastname}
              </span>
              <button
                onClick={() => setShowSettings(true)}
                title="Configurações"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <Settings size={16} />
              </button>
              <button
                onClick={onLogout}
                title="Sair"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-6 flex-shrink-0 overflow-x-auto scrollbar-thin">
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        {activeTab === 'inbox' && <InboxView onIssueClick={setSelectedIssueId} />}

        {activeTab === 'dashboard' && <Dashboard onIssueClick={setSelectedIssueId} />}

        {activeTab === 'people' && <PeopleView onIssueClick={setSelectedIssueId} />}

        {activeTab === 'team' && <TeamView onIssueClick={setSelectedIssueId} />}

        {activeTab === 'release' && <ReleaseView onIssueClick={setSelectedIssueId} />}

        {activeTab === 'notes' && <NotesView onIssueClick={setSelectedIssueId} seed={noteSeed} />}

        {activeTab === 'kanban' && (
          <KanbanBoard
            projectId={selectedProject}
            userName={user ? `${user.firstname} ${user.lastname}` : undefined}
            onIssueClick={setSelectedIssueId}
            focusedIssueId={focusedIssueId ?? undefined}
            onProjectChange={setSelectedProject}
          />
        )}

        {activeTab === 'calendar' && (
          <CalendarView projectId={selectedProject} onIssueClick={setSelectedIssueId} />
        )}

        {activeTab === 'review' && (
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Para revisar</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Tarefas em Pendente Revisão onde você é o revisor — sua fila de revisão.
              </p>
            </div>
            <IssueListView
              issues={toReview.data}
              isLoading={toReview.isLoading}
              isFetching={toReview.isFetching}
              onRefetch={toReview.refetch}
              onIssueClick={setSelectedIssueId}
              showAssignee
              emptyMessage="Nenhuma tarefa aguardando sua revisão."
              focusedIssueId={focusedIssueId ?? undefined}
            />
          </div>
        )}

        {activeTab === 'test' && (
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Para testar</h2>
              <p className="text-sm text-slate-500 mt-0.5">Suas tarefas em Pendente Teste.</p>
            </div>
            <IssueListView
              issues={toTest}
              isLoading={issuesQuery.isLoading}
              isFetching={issuesQuery.isFetching}
              onRefetch={issuesQuery.refetch}
              onIssueClick={setSelectedIssueId}
              emptyMessage="Nenhuma tarefa aguardando teste com você."
              focusedIssueId={focusedIssueId ?? undefined}
            />
          </div>
        )}

        {activeTab === 'integrate' && (
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Para integrar</h2>
              <p className="text-sm text-slate-500 mt-0.5">Suas tarefas em Pendente Integração.</p>
            </div>
            <IssueListView
              issues={toIntegrate}
              isLoading={issuesQuery.isLoading}
              isFetching={issuesQuery.isFetching}
              onRefetch={issuesQuery.refetch}
              onIssueClick={setSelectedIssueId}
              emptyMessage="Nenhuma tarefa aguardando integração com você."
              focusedIssueId={focusedIssueId ?? undefined}
            />
          </div>
        )}

        {activeTab === 'monitoring' && (
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Monitoramento</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Tarefas onde você é o desenvolvedor mas estão com outro responsável — em revisão, teste, integração etc.
              </p>
            </div>
            <IssueListView
              issues={monitored.data}
              isLoading={monitored.isLoading}
              isFetching={monitored.isFetching}
              onRefetch={monitored.refetch}
              onIssueClick={setSelectedIssueId}
              showAssignee
              emptyMessage="Nenhuma tarefa em monitoramento. Todas as suas tarefas estão com você ou fechadas."
              focusedIssueId={focusedIssueId ?? undefined}
            />
          </div>
        )}

        {activeTab === 'authored' && (
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Criadas por mim</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Tarefas que você abriu e ainda estão abertas, independentemente de quem está responsável.
              </p>
            </div>
            <IssueListView
              issues={authored.data}
              isLoading={authored.isLoading}
              isFetching={authored.isFetching}
              onRefetch={authored.refetch}
              onIssueClick={setSelectedIssueId}
              showAssignee
              emptyMessage="Você não tem tarefas abertas criadas por você."
              focusedIssueId={focusedIssueId ?? undefined}
            />
          </div>
        )}

        {activeTab === 'watched' && (
          <div className="max-w-6xl mx-auto">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Observadas</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Tarefas que você acompanha como watcher, mesmo sem ser o responsável.
              </p>
            </div>
            <IssueListView
              issues={watched.data}
              isLoading={watched.isLoading}
              isFetching={watched.isFetching}
              onRefetch={watched.refetch}
              onIssueClick={setSelectedIssueId}
              showAssignee
              emptyMessage="Você não está observando nenhuma tarefa. Abra uma tarefa e clique em 'Observar'."
              focusedIssueId={focusedIssueId ?? undefined}
            />
          </div>
        )}
      </main>

      {/* Modal global */}
      {selectedIssueId && (
        <IssueModal
          issueId={selectedIssueId}
          onClose={() => setSelectedIssueId(null)}
          onNavigate={setSelectedIssueId}
          onNewNote={(patch) => { setSelectedIssueId(null); openNewNote(patch); }}
        />
      )}

      {/* Paleta de comandos (Ctrl/Cmd+K) */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tabs={tabs.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        actions={[
          { id: 'create', label: 'Criar tarefa', icon: <Plus size={14} />, run: () => setShowCreate(true) },
          { id: 'new-note', label: 'Nova nota rápida', icon: <NotebookPen size={14} />, run: () => openNewNote({}) },
          { id: 'theme', label: theme === 'dark' ? 'Tema claro' : 'Tema escuro', icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />, run: toggleTheme },
          ...(selectedIssueId ? [{
            id: 'watch',
            label: watchedIds.includes(selectedIssueId) ? 'Deixar de observar tarefa aberta' : 'Observar tarefa aberta',
            icon: <Star size={14} />,
            run: () => localWatches.toggle(selectedIssueId),
          }] : []),
        ]}
        onSelectTab={id => setActiveTab(id as Tab)}
        onSelectIssue={setSelectedIssueId}
      />

      {/* Criar tarefa (via paleta) */}
      {showCreate && <CreateIssueModal onClose={() => setShowCreate(false)} />}

      {/* Configurações */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* Daily standup */}
      {showStandup && (
        <StandupModal
          issues={allIssues ?? []}
          onClose={() => setShowStandup(false)}
        />
      )}

      {/* Nextcloud Talk — mini chat estilo LinkedIn */}
      <TalkChat
        onIssueClick={setSelectedIssueId}
        openRoomToken={pendingTalkToken}
        onRoomOpened={() => setPendingTalkToken(null)}
      />
    </div>
  );
}
