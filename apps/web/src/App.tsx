import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { BoardPage } from '@/pages/BoardPage';
import { ChatPage } from '@/pages/ChatPage';
import { MembersPage } from '@/pages/MembersPage';
import { SkillsPage } from '@/pages/SkillsPage';
import { HubPage } from '@/pages/HubPage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { DocsPage } from '@/pages/DocsPage';
import { ModelsPage } from '@/pages/ModelsPage';
import { ApiPage } from '@/pages/ApiPage';
import { AuditPage } from '@/pages/AuditPage';
import { NotFound } from '@/pages/NotFound';

/**
 * 路由表（§7.6）。所有页面嵌套在 Layout 之下。
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/board" replace /> },
      { path: 'board', element: <BoardPage /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'chat/:sessionId', element: <ChatPage /> },
      { path: 'members', element: <MembersPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'skills/:skillId', element: <SkillsPage /> },
      { path: 'hub', element: <HubPage /> },
      { path: 'knowledge', element: <KnowledgePage /> },
      { path: 'docs', element: <DocsPage /> },
      { path: 'docs/:docId', element: <DocsPage /> },
      { path: 'models', element: <ModelsPage /> },
      { path: 'api-keys', element: <ApiPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export default router;
