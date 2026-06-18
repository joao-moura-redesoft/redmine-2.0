import { useState, useRef, useEffect, useMemo } from 'react';
import {
  useCurrentUser, useProjects, useMonitoredIssues, useAuthoredIssues,
  useWatchedIssues, useIssues, useToReviewIssues, useMentions, useCompletedIssues,
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
import { getStoredAuth, clearAuth, initSession } from './api/redmine';
import { getAIKey } from './utils/aiConfig';
import { useActivityNotifications } from './hooks/useActivityNotifications';
import { useMailNotifications } from './hooks/useMailNotifications';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useBrowserNotifications } from './hooks/useBrowserNotifications';
import { useTheme } from './hooks/useTheme';
import { useShortcuts } from './hooks/useShortcuts';
import { SettingsModal } from './components/SettingsModal';
import { StandupModal } from './components/StandupModal';
import { TalkChat } from './components/TalkChat';
import { NotesView } from './components/NotesView';
import { AssistantView } from './components/AssistantView';
import { MailView } from './components/MailView';
import { WikiView } from './components/WikiView';
import { TotpView } from './components/TotpView';
import { MyDayView } from './components/MyDayView';
import type { NotePatch } from './api/notes';
import { mailApi } from './api/mail';
import { isMailAvailable } from './utils/mailConfig';
import {
  LayoutGrid, Gem, ChevronDown, ChevronLeft, ChevronRight, Eye, PenLine,
  LogOut, Bell, BellOff, X, BarChart3, Star, Sun, Moon, Users, CalendarDays,
  ClipboardCheck, Inbox, Plus, FlaskConical, GitMerge, Rocket, Settings,
  Sparkles, NotebookPen, Bot, ShieldCheck, AtSign, Mail, BookOpen,
} from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Issue } from './types/redmine';

type Tab = 'inbox' | 'dashboard' | 'myday' | 'kanban' | 'calendar' | 'review' | 'test' | 'integrate' | 'monitoring' | 'authored' | 'watched' | 'people' | 'team' | 'release' | 'notes' | 'assistant' | 'mail' | 'wiki' | 'totp';

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
  useEffect(() => { initSession(); }, []);

  const { data: user } = useCurrentUser();
  const { data: projects } = useProjects();
  const issuesQuery = useIssues();
  const allIssues = issuesQuery.data;
  const toTest = (allIssues ?? []).filter(i => i.status.id === 44);
  const toIntegrate = (allIssues ?? []).filter(i => i.status.id === 35);
  const [selectedProject, setSelectedProject] = useState<number | undefined>(undefined);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Modal de tarefa dirigido pela URL (?issue=123)
  const issueParam = searchParams.get('issue');
  const selectedIssueId = issueParam ? Number(issueParam) : null;
  // push → o botão Voltar fecha o modal mantendo a view atrás
  const openIssue = (id: number) =>
    setSearchParams(prev => { prev.set('issue', String(id)); return prev; });
  const closeIssue = () =>
    setSearchParams(prev => { prev.delete('issue'); return prev; }, { replace: true });
  // Navegar entre tarefas dentro do modal não empilha histórico
  const navigateIssue = (id: number) =>
    setSearchParams(prev => { prev.set('issue', String(id)); return prev; }, { replace: true });

  const [showNotifications, setShowNotifications] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const watchedIds = useLocalWatches();
  const notifRef = useRef<HTMLDivElement>(null);

  const { focusedIssueId } = useShortcuts({
    onOpenIssue: openIssue,
    onOpenPalette: () => setPaletteOpen(o => !o),
    paletteOpen,
    modalOpen: !!selectedIssueId,
  });

  const { theme, toggle: toggleTheme } = useTheme();
  const monitored = useMonitoredIssues();
  const authored = useAuthoredIssues();
  const watched = useWatchedIssues();
  const toReview = useToReviewIssues();
  const mentions = useMentions();
  const completed = useCompletedIssues();
  const mailUnread = useQuery({
    queryKey: ['mail', 'unread'],
    queryFn: mailApi.getUnread,
    enabled: isMailAvailable(),
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: true,
  });

  const inboxCount = (toReview.data?.length ?? 0) + (allIssues ?? []).filter(i => {
    const n = i.status.name.toLowerCase();
    const closed = n.includes('fechad') || n.includes('cancelad');
    return !closed && [34, 32, 8].includes(i.status.id);
  }).length;

  const activityIssues = useMemo(() => {
    const map = new Map<number, Issue>();
    [...(monitored.data ?? []), ...(watched.data ?? [])].forEach(i => map.set(i.id, i));
    return [...map.values()];
  }, [monitored.data, watched.data]);

  const activity = useActivityNotifications(allIssues, activityIssues, toReview.data, user?.id, mentions.data);
  const mailNotifs = useMailNotifications(mailUnread.data);

  const notifications = [...mailNotifs.notifications, ...activity.notifications];
  const dismiss = (id: string) => { activity.dismiss(id); mailNotifs.dismiss(id); };
  const dismissAll = () => { activity.dismissAll(); mailNotifs.dismissAll(); };

  const { permission: notifPermission, requestPermission } = useBrowserNotifications();

  const [showSettings, setShowSettings] = useState(false);
  const [showStandup, setShowStandup] = useState(false);

  const [noteSeed, setNoteSeed] = useState<{ nonce: number; patch: NotePatch } | null>(null);
  const openNewNote = (patch: NotePatch = {}) => {
    setNoteSeed({ nonce: Date.now(), patch });
    navigate('/notes');
  };

  const [notesFocus, setNotesFocus] = useState<{ nonce: number; issueId: number } | null>(null);
  const openTaskNotes = (issueId: number) => {
    setNotesFocus({ nonce: Date.now(), issueId });
    closeIssue();
    navigate('/notes');
  };

  usePushNotifications();

  const [pendingTalkToken, setPendingTalkToken] = useState<string | null>(null);

  useEffect(() => {
    // talkRoom é um deep-link one-shot: consome e limpa só esse param, preservando a rota/?issue=.
    // Removemos via setSearchParams do router (não window.history) — assim o estado interno do
    // react-router fica em sincronia e o param não "ressuscita" no próximo setSearchParams.
    const talkParam = new URLSearchParams(window.location.search).get('talkRoom');
    if (talkParam) {
      setPendingTalkToken(talkParam);
      setSearchParams(prev => { prev.delete('talkRoom'); return prev; }, { replace: true });
    }

    if (!('serviceWorker' in navigator)) return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'open-issue' && e.data.issueId)   openIssue(Number(e.data.issueId));
      if (e.data?.type === 'open-talk'  && e.data.talkToken) setPendingTalkToken(e.data.talkToken);
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node))
        setShowNotifications(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedProjectName = projects?.find(p => p.id === selectedProject)?.name ?? 'Todos os projetos';

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'inbox',      label: 'Aguardando você', icon: <Inbox size={15} />,        count: inboxCount },
    { id: 'dashboard',  label: 'Dashboard',        icon: <BarChart3 size={15} /> },
    { id: 'myday',      label: 'Meu Dia',          icon: <Sun size={15} /> },
    { id: 'kanban',     label: 'Minhas Tarefas',   icon: <LayoutGrid size={15} /> },
    { id: 'calendar',   label: 'Calendário',        icon: <CalendarDays size={15} /> },
    { id: 'review',     label: 'Para revisar',      icon: <ClipboardCheck size={15} />, count: toReview.data?.length },
    ...(toTest.length    ? [{ id: 'test'      as Tab, label: 'Para testar',   icon: <FlaskConical size={15} />, count: toTest.length }]    : []),
    ...(toIntegrate.length ? [{ id: 'integrate' as Tab, label: 'Para integrar', icon: <GitMerge size={15} />,    count: toIntegrate.length }] : []),
    { id: 'monitoring', label: 'Monitoramento',    icon: <Eye size={15} />,          count: monitored.data?.length },
    { id: 'authored',   label: 'Criadas por mim',  icon: <PenLine size={15} />,      count: authored.data?.length },
    { id: 'watched',    label: 'Observadas',        icon: <Star size={15} />,         count: watched.data?.length },
    { id: 'people',     label: 'Pessoas',            icon: <Users size={15} /> },
    { id: 'team',       label: 'Time',               icon: <Users size={15} /> },
    { id: 'release',    label: 'Release',             icon: <Rocket size={15} /> },
    { id: 'mail',       label: 'E-mail',              icon: <Mail size={15} />,         count: mailUnread.data?.unread },
    { id: 'wiki',       label: 'Wiki',                icon: <BookOpen size={15} /> },
    { id: 'notes',      label: 'Notas',               icon: <NotebookPen size={15} /> },
    { id: 'assistant',  label: 'Assistente',          icon: <Bot size={15} /> },
    { id: 'totp',       label: 'Autenticação 2FA',    icon: <ShieldCheck size={15} /> },
  ];

  const tabGroups: { label: string | null; ids: Tab[] }[] = [
    { label: null,           ids: ['inbox', 'dashboard', 'myday', 'kanban', 'calendar'] },
    { label: 'Fila',         ids: ['review', ...(toTest.length ? ['test' as Tab] : []), ...(toIntegrate.length ? ['integrate' as Tab] : []), 'monitoring'] },
    { label: 'Descoberta',   ids: ['authored', 'watched'] },
    { label: 'Colaboração',  ids: ['people', 'team', 'release'] },
    { label: 'Ferramentas',  ids: ['mail', 'wiki', 'notes', 'assistant', 'totp'] },
  ];

  const tabMap = Object.fromEntries(tabs.map(t => [t.id, t])) as Record<Tab, typeof tabs[0]>;

  const NavItem = ({ tab }: { tab: typeof tabs[0] }) => (
    <NavLink
      to={`/${tab.id}`}
      title={sidebarCollapsed ? tab.label : undefined}
      className={({ isActive }) => `w-full flex items-center gap-2.5 rounded-lg transition-colors text-sm text-left relative
        ${sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2'}
        ${isActive
          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
        }`}
    >
      {({ isActive }) => (
        <>
          <span className="flex-shrink-0 relative">
            {tab.icon}
            {sidebarCollapsed && tab.count !== undefined && tab.count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                {tab.count > 9 ? '9+' : tab.count}
              </span>
            )}
          </span>
          {!sidebarCollapsed && (
            <>
              <span className="flex-1 truncate">{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                  isActive
                    ? 'bg-blue-100 dark:bg-blue-800/60 text-blue-700 dark:text-blue-300'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                }`}>
                  {tab.count}
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );

  return (
    <div className="h-screen flex overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* ── Sidebar ── */}
      <aside className={`flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex-shrink-0 transition-all duration-200 ${sidebarCollapsed ? 'w-[52px]' : 'w-[220px]'}`}>

        {/* Logo */}
        <div className={`flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 flex-shrink-0 ${sidebarCollapsed ? 'px-2 py-3 justify-center' : 'px-3 py-3'}`}>
          <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center flex-shrink-0">
            <Gem size={14} className="text-white" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100">Bluemine</h1>
              <p className="text-[10px] text-slate-400">b2click.com</p>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex-shrink-0 transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 scrollbar-thin space-y-0.5">
          {tabGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? 'pt-2' : ''}>
              {group.label && !sidebarCollapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {group.label}
                </p>
              )}
              {gi > 0 && sidebarCollapsed && (
                <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
              )}
              {group.ids.map(id => tabMap[id] && <NavItem key={id} tab={tabMap[id]} />)}
            </div>
          ))}
        </nav>

        {/* Bottom controls */}
        <div className={`border-t border-slate-100 dark:border-slate-800 p-2 flex flex-col gap-1 flex-shrink-0 ${sidebarCollapsed ? 'items-center' : ''}`}>
          {/* Standup */}
          {getAIKey() && (
            <button
              onClick={() => setShowStandup(true)}
              title="Gerar daily standup com IA"
              className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}
            >
              <Sparkles size={14} className="flex-shrink-0" />
              {!sidebarCollapsed && 'Standup'}
            </button>
          )}

          {/* Theme */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}
          >
            {theme === 'dark' ? <Sun size={15} className="flex-shrink-0" /> : <Moon size={15} className="flex-shrink-0" />}
            {!sidebarCollapsed && (theme === 'dark' ? 'Modo claro' : 'Modo escuro')}
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            title="Configurações"
            className={`flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}
          >
            <Settings size={15} className="flex-shrink-0" />
            {!sidebarCollapsed && 'Configurações'}
          </button>

          {/* User + Logout */}
          {user && (
            <div className={`flex items-center gap-2 px-2 py-1.5 mt-0.5 ${sidebarCollapsed ? 'justify-center' : ''}`}>
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                {user.firstname.charAt(0)}{user.lastname.charAt(0)}
              </div>
              {!sidebarCollapsed && (
                <span className="flex-1 text-xs text-slate-600 dark:text-slate-400 truncate">
                  {user.firstname} {user.lastname}
                </span>
              )}
              <button
                onClick={onLogout}
                title="Sair"
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
              >
                <LogOut size={13} />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-3 flex-shrink-0">
          {/* Search */}
          <div className="flex-1 min-w-0">
            <GlobalSearch onSelectIssue={openIssue} />
          </div>

          {/* Project selector (Kanban only) */}
          {location.pathname === '/kanban' && (
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowProjectMenu(!showProjectMenu)}
                className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors max-w-44 truncate"
              >
                <span className="truncate">{selectedProjectName}</span>
                <ChevronDown size={14} className="flex-shrink-0" />
              </button>
              {showProjectMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-20 min-w-52 py-1 max-h-80 overflow-y-auto scrollbar-thin">
                  <button
                    onClick={() => { setSelectedProject(undefined); setShowProjectMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${!selectedProject ? 'font-medium text-blue-600' : 'text-slate-700 dark:text-slate-300'}`}
                  >
                    Todos os projetos
                  </button>
                  <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
                  {projects?.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProject(p.id); setShowProjectMenu(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors ${selectedProject === p.id ? 'font-medium text-blue-600' : 'text-slate-700 dark:text-slate-300'}`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notificação permission */}
          {notifPermission !== 'granted' && 'Notification' in window && (
            <button
              onClick={requestPermission}
              title={notifPermission === 'denied' ? 'Notificações bloqueadas' : 'Ativar notificações'}
              disabled={notifPermission === 'denied'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors flex-shrink-0 ${
                notifPermission === 'denied'
                  ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                  : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              <BellOff size={13} />
              <span className="hidden sm:inline">{notifPermission === 'denied' ? 'Bloqueadas' : 'Ativar notificações'}</span>
            </button>
          )}

          {/* Sino */}
          <div className="relative flex-shrink-0" ref={notifRef}>
            <button
              onClick={() => setShowNotifications(v => !v)}
              className="relative p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              title="Notificações"
            >
              <Bell size={17} />
              {notifications.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {notifications.length > 9 ? '9+' : notifications.length}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {notifications.length === 0 ? 'Sem novidades' : `${notifications.length} notificaç${notifications.length !== 1 ? 'ões' : 'ão'}`}
                  </span>
                  {notifications.length > 0 && (
                    <button onClick={dismissAll} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
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
                      <div key={n.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-50 dark:border-slate-800 last:border-0 group">
                        <span className={`mt-1 flex-shrink-0 ${n.type === 'assigned' ? 'text-blue-500' : n.type === 'review' ? 'text-violet-500' : n.type === 'mention' ? 'text-pink-500' : n.type === 'mail' ? 'text-teal-500' : 'text-purple-500'}`}>
                          {n.type === 'assigned' ? <LayoutGrid size={14} /> : n.type === 'review' ? <ClipboardCheck size={14} /> : n.type === 'mention' ? <AtSign size={14} /> : n.type === 'mail' ? <Mail size={14} /> : <Bell size={14} />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <button
                            className="text-left w-full"
                            onClick={() => {
                              if (n.type === 'mail') {
                                navigate('/mail');
                              } else if (n.issue) {
                                openIssue(n.issue.id);
                              }
                              setShowNotifications(false);
                              dismiss(n.id);
                            }}
                          >
                            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                              {n.type === 'assigned' ? 'Atribuída a você' : n.type === 'review' ? 'Pedido de revisão' : n.type === 'mention' ? `Menção${n.author ? ` de ${n.author}` : ''}` : n.type === 'mail' ? 'Novo e-mail' : 'Nova atividade'}
                            </p>
                            {n.issue && (
                              <p className="text-xs font-semibold text-blue-600 hover:underline truncate mt-0.5">
                                #{n.issue.id} — {n.issue.subject}
                              </p>
                            )}
                            {n.snippet && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{n.type === 'mail' ? n.snippet : `"${n.snippet}"`}</p>
                            )}
                            <p className="text-xs text-slate-400 mt-0.5">
                              {formatDistanceToNow(n.seenAt, { addSuffix: true, locale: ptBR })}
                            </p>
                          </button>
                        </div>
                        <button onClick={() => dismiss(n.id)} className="text-slate-300 hover:text-slate-500 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/inbox"     element={<InboxView onIssueClick={openIssue} />} />
            <Route path="/dashboard" element={<Dashboard onIssueClick={openIssue} />} />
            <Route path="/myday"     element={<MyDayView onIssueClick={openIssue} />} />
            <Route path="/people"    element={<PeopleView onIssueClick={openIssue} />} />
            <Route path="/team"      element={<TeamView onIssueClick={openIssue} />} />
            <Route path="/release"   element={<ReleaseView onIssueClick={openIssue} />} />
            <Route path="/notes"     element={<NotesView onIssueClick={openIssue} seed={noteSeed} focus={notesFocus} />} />
            <Route path="/assistant" element={<AssistantView onIssueClick={openIssue} />} />
            <Route path="/mail"      element={<MailView />} />
            <Route path="/wiki"      element={<WikiView />} />
            <Route path="/totp"      element={<TotpView />} />

            <Route path="/kanban" element={
              <KanbanBoard
                projectId={selectedProject}
                userName={user ? `${user.firstname} ${user.lastname}` : undefined}
                onIssueClick={openIssue}
                focusedIssueId={focusedIssueId ?? undefined}
                onProjectChange={setSelectedProject}
              />
            } />

            <Route path="/calendar" element={
              <CalendarView projectId={selectedProject} onIssueClick={openIssue} />
            } />

            <Route path="/review" element={
              <div className="max-w-6xl mx-auto">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Para revisar</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Tarefas em Pendente Revisão onde você é o revisor — sua fila de revisão.</p>
                </div>
                <IssueListView issues={toReview.data} isLoading={toReview.isLoading} isFetching={toReview.isFetching} onRefetch={toReview.refetch} onIssueClick={openIssue} showAssignee emptyMessage="Nenhuma tarefa aguardando sua revisão." focusedIssueId={focusedIssueId ?? undefined} />
              </div>
            } />

            <Route path="/test" element={
              <div className="max-w-6xl mx-auto">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Para testar</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Suas tarefas em Pendente Teste.</p>
                </div>
                <IssueListView issues={toTest} isLoading={issuesQuery.isLoading} isFetching={issuesQuery.isFetching} onRefetch={issuesQuery.refetch} onIssueClick={openIssue} emptyMessage="Nenhuma tarefa aguardando teste com você." focusedIssueId={focusedIssueId ?? undefined} />
              </div>
            } />

            <Route path="/integrate" element={
              <div className="max-w-6xl mx-auto">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Para integrar</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Suas tarefas em Pendente Integração.</p>
                </div>
                <IssueListView issues={toIntegrate} isLoading={issuesQuery.isLoading} isFetching={issuesQuery.isFetching} onRefetch={issuesQuery.refetch} onIssueClick={openIssue} emptyMessage="Nenhuma tarefa aguardando integração com você." focusedIssueId={focusedIssueId ?? undefined} />
              </div>
            } />

            <Route path="/monitoring" element={
              <div className="max-w-6xl mx-auto">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Monitoramento</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Tarefas onde você é o desenvolvedor mas estão com outro responsável — em revisão, teste, integração etc.</p>
                </div>
                <IssueListView issues={monitored.data} isLoading={monitored.isLoading} isFetching={monitored.isFetching} onRefetch={monitored.refetch} onIssueClick={openIssue} showAssignee emptyMessage="Nenhuma tarefa em monitoramento." focusedIssueId={focusedIssueId ?? undefined} />
              </div>
            } />

            <Route path="/authored" element={
              <div className="max-w-6xl mx-auto">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Criadas por mim</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Tarefas que você abriu e ainda estão abertas, independentemente de quem está responsável.</p>
                </div>
                <IssueListView issues={authored.data} isLoading={authored.isLoading} isFetching={authored.isFetching} onRefetch={authored.refetch} onIssueClick={openIssue} showAssignee emptyMessage="Você não tem tarefas abertas criadas por você." focusedIssueId={focusedIssueId ?? undefined} />
              </div>
            } />

            <Route path="/watched" element={
              <div className="max-w-6xl mx-auto">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Observadas</h2>
                  <p className="text-sm text-slate-500 mt-0.5">Tarefas que você acompanha como watcher, mesmo sem ser o responsável.</p>
                </div>
                <IssueListView issues={watched.data} isLoading={watched.isLoading} isFetching={watched.isFetching} onRefetch={watched.refetch} onIssueClick={openIssue} showAssignee emptyMessage="Você não está observando nenhuma tarefa." focusedIssueId={focusedIssueId ?? undefined} />
              </div>
            } />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>

      {/* Modal global */}
      {selectedIssueId && (
        <IssueModal
          issueId={selectedIssueId}
          onClose={closeIssue}
          onNavigate={navigateIssue}
          onNewNote={(patch) => { closeIssue(); openNewNote(patch); }}
          onViewNotes={openTaskNotes}
        />
      )}

      {/* Paleta de comandos */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tabs={tabs.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        actions={[
          { id: 'create',   label: 'Criar tarefa',    icon: <Plus size={14} />,      run: () => setShowCreate(true) },
          { id: 'new-note', label: 'Nova nota rápida', icon: <NotebookPen size={14} />, run: () => openNewNote({}) },
          { id: 'theme',    label: theme === 'dark' ? 'Tema claro' : 'Tema escuro', icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />, run: toggleTheme },
          ...(selectedIssueId ? [{
            id: 'watch',
            label: watchedIds.includes(selectedIssueId) ? 'Deixar de observar tarefa aberta' : 'Observar tarefa aberta',
            icon: <Star size={14} />,
            run: () => localWatches.toggle(selectedIssueId),
          }] : []),
        ]}
        onSelectTab={id => navigate(`/${id}`)}
        onSelectIssue={openIssue}
      />

      {showCreate  && <CreateIssueModal onClose={() => setShowCreate(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {showStandup && (
        <StandupModal issues={allIssues ?? []} completedIssues={completed.data ?? []} onClose={() => setShowStandup(false)} />
      )}

      <TalkChat
        onIssueClick={openIssue}
        openRoomToken={pendingTalkToken}
        onRoomOpened={() => setPendingTalkToken(null)}
      />
    </div>
  );
}
