import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus, MessageCircle, Plus, Send, Users, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { chatApi, mediaApi, userApi } from '../api/endpoints';
import { Avatar, EmptyState, Modal, PageLoader, RetryImage, Spinner } from '../components/ui';
import { useCursorList } from '../hooks/useCursorList';
import { errorMessage } from '../lib/errors';
import { clockTime, timeAgo } from '../lib/format';
import { useAuth } from '../store/auth';
import { useRealtime } from '../store/realtime';
import { toast } from '../store/toast';

function NewGroupChat({ open, onClose }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const friends = useQuery({ queryKey: ['friends', 'me'], queryFn: () => userApi.friends(), enabled: open });
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState([]);
  const m = useMutation({
    mutationFn: () => chatApi.createGroup(title, picked),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      onClose();
      navigate(`/chat/${c.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <Modal open={open} onClose={onClose} title="Tạo nhóm chat">
      <input
        className="input"
        placeholder="Tên nhóm chat"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
      />
      <p className="mb-2 mt-4 text-sm font-medium">Chọn ít nhất 2 bạn bè</p>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {(friends.data || []).map((f) => (
          <li key={f.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-paper">
              <input
                type="checkbox"
                className="accent-ink"
                checked={picked.includes(f.id)}
                onChange={() => toggle(f.id)}
              />
              <Avatar user={f} size={32} />
              <span className="text-sm">{f.full_name}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        className="btn-primary mt-4 w-full"
        disabled={picked.length < 2 || m.isPending}
        onClick={() => m.mutate()}
      >
        Tạo nhóm ({picked.length + 1} người)
      </button>
    </Modal>
  );
}

function ConversationList({ activeId }) {
  const [creating, setCreating] = useState(false);
  const myId = useAuth((s) => s.user?.id);
  const online = useRealtime((s) => s.online);
  const convs = useQuery({ queryKey: ['conversations'], queryFn: chatApi.conversations });
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <h1 className="text-lg font-bold">Tin nhắn</h1>
        <button
          className="rounded-full bg-ink-50 p-2 text-ink hover:bg-ink-100"
          onClick={() => setCreating(true)}
          aria-label="Tạo nhóm chat"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {convs.isLoading && <PageLoader />}
      <ul className="flex-1 min-h-0 overflow-y-auto">
        {(convs.data || []).map((c) => {
          const other = c.members.find((m) => m.id !== myId);
          const isOnline =
            c.type === 'DIRECT'
              ? online.has(other?.id)
              : c.members.some((m) => m.id !== myId && online.has(m.id));
          return (
            <li key={c.id}>
              <Link
                to={`/chat/${c.id}`}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 hover:bg-paper',
                  c.id === activeId && 'bg-ink-50',
                )}
              >
                <span className="relative">
                  {c.type === 'DIRECT' ? (
                    <Avatar user={other} size={44} />
                  ) : (
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-ink">
                      <Users className="h-5 w-5" />
                    </span>
                  )}
                  {isOnline && (
                    <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-success" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={clsx('block truncate text-sm', c.unread_count ? 'font-bold' : 'font-medium')}
                  >
                    {c.title}
                  </span>
                  <span
                    className={clsx(
                      'block truncate text-xs',
                      c.unread_count ? 'font-semibold text-text' : 'text-muted',
                    )}
                  >
                    {c.last_message
                      ? `${c.last_message.sender_id === myId ? 'Bạn: ' : ''}${c.last_message.content || 'Đã gửi một tệp'}`
                      : 'Bắt đầu trò chuyện'}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="text-[11px] text-muted">{timeAgo(c.last_message_at)}</span>
                  {c.unread_count > 0 && <span className="h-2.5 w-2.5 rounded-full bg-amber" />}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {convs.isSuccess && !convs.data.length && (
        <p className="p-4 text-sm text-muted">
          Chưa có cuộc trò chuyện. Vào trang cá nhân của bạn bè và bấm “Nhắn tin”.
        </p>
      )}
      <NewGroupChat open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function Conversation({ id }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const send = useRealtime((s) => s.send);
  const typingMap = useRealtime((s) => s.typing[id]);
  const online = useRealtime((s) => s.online);
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const typingSent = useRef(0);

  const conv = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => chatApi.conversation(id),
    retry: false,
  });
  const msgs = useCursorList(['messages', id], (c) => chatApi.messages(id, c));
  const ordered = useMemo(() => [...msgs.items].reverse(), [msgs.items]);
  const lastId = ordered[ordered.length - 1]?.id;

  useEffect(() => {
    if (!lastId) return;
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ block: 'nearest' });
    }
    if (!send({ type: 'read', conversation_id: id })) chatApi.read(id).catch(() => {});
  }, [lastId, id, send]);

  const pushLocal = (msg) =>
    qc.setQueryData(['messages', id], (old) => {
      if (!old) return old;
      const pages = [...old.pages];
      pages[0] = { ...pages[0], results: [msg, ...pages[0].results] };
      return { ...old, pages };
    });

  const sendMessage = async (payload) => {
    const client_id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    pushLocal({
      id: client_id,
      client_id,
      conversation_id: id,
      sender_id: me.id,
      created_at: new Date().toISOString(),
      pending: true,
      ...payload,
    });
    const viaWs = send({ type: 'message.send', conversation_id: id, client_id, ...payload });
    if (!viaWs) {
      try {
        await chatApi.send(id, { ...payload, client_id });
        qc.invalidateQueries({ queryKey: ['messages', id] });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    }
  };

  const onType = (v) => {
    setText(v);
    if (Date.now() - typingSent.current > 2000) {
      typingSent.current = Date.now();
      send({ type: 'typing', conversation_id: id, is_typing: true });
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    sendMessage({ content: text.trim() });
    setText('');
    typingSent.current = 0;
    send({ type: 'typing', conversation_id: id, is_typing: false });
  };

  const attach = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await mediaApi.upload(file, 'chat');
      await sendMessage({ content: '', file_url: res.url, file_type: res.media_type });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const leave = useMutation({
    mutationFn: () => chatApi.removeMember(id, me.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      navigate('/chat');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (conv.isError) return <EmptyState title="Không mở được cuộc trò chuyện" />;
  const c = conv.data;
  const others = c?.members.filter((m) => m.id !== me.id) || [];
  const typers = Object.values(typingMap || {}).filter((t) => t.until > Date.now());
  const lastMine = [...ordered].reverse().find((m) => m.sender_id === me.id && !m.pending);
  const seenBy = lastMine
    ? others.filter((o) => o.last_read_at && o.last_read_at >= lastMine.created_at)
    : [];
  const nameOf = (uid) => c?.members.find((m) => m.id === uid);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <Link to="/chat" className="rounded-full p-1 hover:bg-paper md:hidden" aria-label="Quay lại">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {c?.type === 'DIRECT' ? (
          <Avatar user={others[0]} size={40} showOnline />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-ink">
            <Users className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{c?.title}</p>
          <p className="text-xs text-muted">
            {c?.type === 'DIRECT'
              ? online.has(others[0]?.id)
                ? 'Đang hoạt động'
                : 'Ngoại tuyến'
              : `${c?.members.length || 0} thành viên`}
          </p>
        </div>
        {c?.type === 'GROUP' && (
          <button
            className="btn-ghost px-3"
            onClick={() => window.confirm('Rời nhóm chat?') && leave.mutate()}
            title="Rời nhóm chat"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </header>

      <div ref={listRef} className="flex-1 min-h-0 space-y-1 overflow-y-auto bg-paper px-4 py-4">
        {msgs.hasNextPage && (
          <div className="flex justify-center pb-2">
            <button
              className="btn-ghost text-xs"
              onClick={() => msgs.fetchNextPage()}
              disabled={msgs.isFetchingNextPage}
            >
              {msgs.isFetchingNextPage ? <Spinner className="h-4 w-4" /> : 'Tải tin nhắn cũ hơn'}
            </button>
          </div>
        )}
        {msgs.isLoading && <PageLoader />}
        {ordered.map((m, i) => {
          const mine = m.sender_id === me.id;
          const prev = ordered[i - 1];
          const showName = !mine && c?.type === 'GROUP' && prev?.sender_id !== m.sender_id;
          return (
            <div key={m.id} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={clsx('max-w-[75%]', m.pending && 'opacity-60')}>
                {showName && (
                  <p className="mb-0.5 ml-3 text-xs text-muted">{nameOf(m.sender_id)?.full_name}</p>
                )}
                {m.file_url &&
                  (m.file_type === 'VIDEO' ? (
                    <video src={m.file_url} controls className="mb-1 max-h-72 rounded-2xl" />
                  ) : (
                    <a href={m.file_url} target="_blank" rel="noreferrer">
                      <RetryImage src={m.file_url} className="mb-1 max-h-72 rounded-2xl" />
                    </a>
                  ))}
                {m.content && (
                  <p
                    className={clsx(
                      'whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3.5 py-2 text-[15px]',
                      mine ? 'bg-ink text-white' : 'bg-white text-text shadow-card',
                    )}
                    title={clockTime(m.created_at)}
                  >
                    {m.content}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {seenBy.length > 0 && (
          <p className="pr-1 text-right text-[11px] text-muted">
            {c?.type === 'DIRECT'
              ? 'Đã xem'
              : `Đã xem bởi ${seenBy.map((s) => s.full_name.split(' ').pop()).join(', ')}`}
          </p>
        )}
        {typers.length > 0 && (
          <p className="text-xs italic text-muted">{typers.map((t) => t.name).join(', ')} đang soạn tin...</p>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-line bg-white p-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/mp4,video/webm"
          className="hidden"
          onChange={(e) => {
            attach(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="rounded-full p-2 text-ink hover:bg-paper"
          onClick={() => fileRef.current?.click()}
          aria-label="Gửi ảnh"
        >
          {uploading ? <Spinner className="h-5 w-5" /> : <ImagePlus className="h-5 w-5" />}
        </button>
        <input
          className="input rounded-full"
          placeholder="Aa"
          value={text}
          onChange={(e) => onType(e.target.value)}
          maxLength={5000}
          aria-label="Nội dung tin nhắn"
        />
        <button
          className="rounded-full bg-ink p-2.5 text-white disabled:opacity-40"
          disabled={!text.trim()}
          aria-label="Gửi"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

/** UC-22 -> UC-24: chat 1-1 / nhóm realtime qua WebSocket, typing, đã xem, online. */
export default function ChatPage() {
  const { conversationId } = useParams();
  return (
    <div className="card grid h-[calc(100vh-140px)] overflow-hidden md:grid-cols-[300px_1fr] lg:h-[calc(100vh-100px)]">
      <aside
        className={clsx(
          'border-r border-line h-full min-h-0 overflow-hidden',
          conversationId && 'hidden md:block',
        )}
      >
        <ConversationList activeId={conversationId} />
      </aside>
      <section
        className={clsx(
          'min-w-0 h-full min-h-0 flex flex-col overflow-hidden',
          !conversationId && 'hidden md:block',
        )}
      >
        {conversationId ? (
          <Conversation key={conversationId} id={conversationId} />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState icon={MessageCircle} title="Chọn một cuộc trò chuyện">
              Tin nhắn được gửi và nhận ngay lập tức.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}
