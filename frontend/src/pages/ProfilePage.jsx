import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, MapPin, Cake, MessageCircle, Ban, Flag, Pencil, UserX } from 'lucide-react';
import { chatApi, mediaApi, postApi, userApi } from '../api/endpoints';
import { confirmDialog } from '../components/ConfirmDialog';
import FriendButton from '../components/FriendButton';
import PostCard from '../components/PostCard';
import PostComposer from '../components/PostComposer';
import ReportDialog from '../components/ReportDialog';
import {
  Avatar,
  EmptyState,
  LoadMore,
  Modal,
  PageLoader,
  RetryImage,
  Tabs,
  UserLink,
} from '../components/ui';
import { useCursorList } from '../hooks/useCursorList';
import { errorMessage } from '../lib/errors';
import { timeAgo } from '../lib/format';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';

function EditProfile({ profile, open, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    full_name: profile.full_name,
    bio: profile.bio,
    location: profile.location,
    birth_date: profile.birth_date || '',
  });
  const m = useMutation({
    mutationFn: () => userApi.updateMe({ ...form, birth_date: form.birth_date || null }),
    onSuccess: (p) => {
      qc.setQueryData(['profile', p.id], p);
      useAuth
        .getState()
        .setUser({ ...useAuth.getState().user, full_name: p.full_name, avatar_url: p.avatar_url });
      toast.success('Đã cập nhật hồ sơ');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Chỉnh sửa hồ sơ">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div>
          <label className="label">Họ và tên</label>
          <input
            className="input"
            value={form.full_name}
            onChange={set('full_name')}
            required
            maxLength={100}
          />
        </div>
        <div>
          <label className="label">Tiểu sử</label>
          <textarea className="input min-h-20" value={form.bio} onChange={set('bio')} maxLength={1000} />
        </div>
        <div>
          <label className="label">Nơi sống</label>
          <input className="input" value={form.location} onChange={set('location')} maxLength={100} />
        </div>
        <div>
          <label className="label">Ngày sinh</label>
          <input type="date" className="input" value={form.birth_date} onChange={set('birth_date')} />
        </div>
        <button className="btn-primary w-full" disabled={m.isPending}>
          Lưu hồ sơ
        </button>
      </form>
    </Modal>
  );
}

/** UC-07: trang cá nhân (của mình hoặc người khác) + dòng thời gian + ảnh đại diện/ảnh bìa. */
export default function ProfilePage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const isMe = me?.id === userId;
  const [tab, setTab] = useState('posts');
  const [editing, setEditing] = useState(false);
  const [report, setReport] = useState(null);
  const avatarRef = useRef(null);
  const coverRef = useRef(null);

  const profile = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => userApi.profile(userId),
    retry: false,
  });
  const posts = useCursorList(['user-posts', userId], (c) => postApi.byUser(userId, c), {
    enabled: tab === 'posts' && profile.isSuccess,
  });
  const friends = useQuery({
    queryKey: ['friends', userId],
    queryFn: () => userApi.friends(userId),
    enabled: tab === 'friends',
  });
  const shares = useQuery({
    queryKey: ['shares', userId],
    queryFn: () => postApi.shares(userId),
    enabled: tab === 'shares',
  });

  const upload = useMutation({
    mutationFn: async ({ file, purpose }) => {
      const res = await mediaApi.upload(file, purpose);
      return userApi.updateMe({ [`${purpose}_url`]: res.url });
    },
    onSuccess: (p) => {
      qc.setQueryData(['profile', userId], p);
      useAuth.getState().setUser({ ...me, avatar_url: p.avatar_url });
      toast.success('Đã cập nhật ảnh. Ảnh sẽ hiển thị sau vài giây khi xử lý xong.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const block = useMutation({
    mutationFn: () => userApi.block(userId),
    onSuccess: () => {
      toast.success('Đã chặn người dùng');
      qc.invalidateQueries({ queryKey: ['profile', userId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const openChat = useMutation({
    mutationFn: () => chatApi.direct(userId),
    onSuccess: (c) => navigate(`/chat/${c.id}`),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (profile.isLoading) return <PageLoader />;
  if (profile.isError)
    return (
      <EmptyState icon={UserX} title="Không tìm thấy người dùng">
        Tài khoản không tồn tại hoặc không khả dụng.
      </EmptyState>
    );
  const p = profile.data;
  const rel = p.relationship?.status;
  const pinned = posts.firstPage?.pinned || [];
  const pickFile = (purpose) => (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) upload.mutate({ file, purpose });
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      <section className="card overflow-hidden">
        <div className="relative h-40 bg-gradient-to-br from-ink to-ink-600 sm:h-56">
          {p.cover_url && <RetryImage src={p.cover_url} className="h-full w-full object-cover" />}
          {isMe && (
            <>
              <input
                ref={coverRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={pickFile('cover')}
              />
              <button
                className="btn absolute bottom-3 right-3 bg-white/90 text-ink hover:bg-white"
                onClick={() => coverRef.current?.click()}
              >
                <Camera className="h-4 w-4" /> Ảnh bìa
              </button>
            </>
          )}
        </div>
        <div className="px-5 pb-5">
          <div className="-mt-12 flex flex-wrap items-end gap-4">
            <div className="relative rounded-full border-4 border-white bg-white">
              <Avatar user={p} size={112} />
              {isMe && (
                <>
                  <input
                    ref={avatarRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={pickFile('avatar')}
                  />
                  <button
                    className="absolute bottom-1 right-1 rounded-full bg-ink p-2 text-white"
                    onClick={() => avatarRef.current?.click()}
                    aria-label="Đổi ảnh đại diện"
                  >
                    <Camera className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="text-2xl font-bold">{p.full_name}</h1>
              <p className="text-sm text-muted">{p.friends_count} bạn bè</p>
            </div>
            <div className="flex flex-wrap gap-2 pb-1">
              {isMe ? (
                <button className="btn-ghost" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> Chỉnh sửa hồ sơ
                </button>
              ) : (
                <>
                  <FriendButton userId={userId} relationship={p.relationship} />
                  {rel === 'FRIENDS' && (
                    <button className="btn-ghost" onClick={() => openChat.mutate()}>
                      <MessageCircle className="h-4 w-4" /> Nhắn tin
                    </button>
                  )}
                  {rel !== 'BLOCKED' && (
                    <button
                      className="btn-ghost px-3"
                      title="Chặn"
                      aria-label="Chặn"
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: `Chặn ${p.full_name}?`,
                          message: 'Hai bạn sẽ không thấy nhau, không nhắn tin và không kết bạn được nữa.',
                          confirmText: 'Chặn',
                          danger: true,
                        });
                        if (ok) block.mutate();
                      }}
                    >
                      <Ban className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    className="btn-ghost px-3"
                    title="Báo cáo"
                    aria-label="Báo cáo"
                    onClick={() => setReport({ type: 'USER', id: userId })}
                  >
                    <Flag className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
          {(p.bio || p.location || p.birth_date) && (
            <div className="mt-4 space-y-1.5 text-sm">
              {p.bio && <p className="whitespace-pre-wrap">{p.bio}</p>}
              {p.location && (
                <p className="flex items-center gap-2 text-muted">
                  <MapPin className="h-4 w-4" /> {p.location}
                </p>
              )}
              {p.birth_date && (
                <p className="flex items-center gap-2 text-muted">
                  <Cake className="h-4 w-4" /> {new Date(p.birth_date).toLocaleDateString('vi-VN')}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="px-3">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'posts', label: 'Bài viết' },
              { value: 'friends', label: 'Bạn bè' },
              { value: 'shares', label: 'Đã chia sẻ' },
            ]}
          />
        </div>
      </section>

      {rel === 'BLOCKED' && <EmptyState icon={Ban} title="Bạn đang chặn người này" />}

      {tab === 'posts' && rel !== 'BLOCKED' && (
        <div className="space-y-4">
          {isMe && <PostComposer invalidateKeys={[['user-posts', userId], ['feed']]} />}
          {pinned.map((post) => (
            <PostCard key={`pin-${post.id}`} post={post} queryKeys={[['user-posts', userId]]} />
          ))}
          {posts.items
            .filter((x) => !pinned.some((pp) => pp.id === x.id))
            .map((post) => (
              <PostCard key={post.id} post={post} queryKeys={[['user-posts', userId]]} />
            ))}
          {posts.isSuccess && posts.items.length === 0 && (
            <EmptyState title="Chưa có bài viết nào hiển thị" />
          )}
          <LoadMore query={posts} />
        </div>
      )}

      {tab === 'friends' && (
        <section className="card grid gap-3 p-4 sm:grid-cols-2">
          {(friends.data || []).map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
              <Avatar user={f} size={48} showOnline />
              <UserLink user={f} />
            </div>
          ))}
          {friends.isSuccess && !friends.data.length && <p className="text-sm text-muted">Chưa có bạn bè.</p>}
        </section>
      )}

      {tab === 'shares' && (
        <div className="space-y-4">
          {(shares.data || []).map((s) => (
            <div key={s.id} className="space-y-2">
              <p className="px-1 text-sm text-muted">
                <UserLink user={s.user} className="text-text" /> đã chia sẻ · {timeAgo(s.created_at)}
                {s.content && <span className="mt-1 block text-text">{s.content}</span>}
              </p>
              {s.post && <PostCard post={s.post} queryKeys={[['shares', userId]]} />}
            </div>
          ))}
          {shares.isSuccess && !shares.data.length && <EmptyState title="Chưa chia sẻ bài viết nào" />}
        </div>
      )}

      {isMe && editing && <EditProfile profile={p} open={editing} onClose={() => setEditing(false)} />}
      {report && <ReportDialog target={report} onClose={() => setReport(null)} />}
    </div>
  );
}
