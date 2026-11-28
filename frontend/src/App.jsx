import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { refreshSession } from './api/client';
import AppShell from './components/AppShell';
import { ConfirmHost } from './components/ConfirmDialog';
import { PageLoader, Toaster } from './components/ui';
import { useAuth } from './store/auth';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import FeedPage from './pages/FeedPage';

const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const FriendsPage = lazy(() => import('./pages/FriendsPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const GroupsPage = lazy(() => import('./pages/GroupsPage'));
const GroupDetailPage = lazy(() => import('./pages/GroupDetailPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const PostPage = lazy(() => import('./pages/PostPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));

function RequireAuth({ children, admin }) {
  const { accessToken, user } = useAuth();
  const location = useLocation();
  if (!accessToken) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  return children;
}

function GuestOnly({ children }) {
  const token = useAuth((s) => s.accessToken);
  return token ? <Navigate to="/" replace /> : children;
}

export default function App() {
  const ready = useAuth((s) => s.ready);

  // F5 trang: access token trong RAM mất -> dùng refresh token (HttpOnly Cookie) để khôi phục phiên.
  useEffect(() => {
    refreshSession().catch(() => useAuth.getState().markReady());
  }, []);

  if (!ready) return <PageLoader />;

  return (
    <>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route
            path="/login"
            element={
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            }
          />
          <Route
            path="/register"
            element={
              <GuestOnly>
                <RegisterPage />
              </GuestOnly>
            }
          />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route
            path="/forgot-password"
            element={
              <GuestOnly>
                <ForgotPasswordPage />
              </GuestOnly>
            }
          />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<FeedPage />} />
            <Route path="u/:userId" element={<ProfilePage />} />
            <Route path="friends" element={<FriendsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="groups/:groupId" element={<GroupDetailPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="chat/:conversationId" element={<ChatPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="posts/:postId" element={<PostPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route
              path="admin"
              element={
                <RequireAuth admin>
                  <AdminPage />
                </RequireAuth>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
      <ConfirmHost />
    </>
  );
}
