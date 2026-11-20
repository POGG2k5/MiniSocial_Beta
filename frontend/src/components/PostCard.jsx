import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Heart,
  MessageCircle,
  Share2,
  MoreHorizontal,
  Globe2,
  Users,
  Lock,
  Pin,
  Flag,
  Pencil,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';
import { postApi } from '../api/endpoints';
import { errorMessage } from '../lib/errors';
import { PRIVACY_LABEL, compactNumber, timeAgo } from '../lib/format';
import { toast } from '../store/toast';
import CommentThread from './CommentThread';
import PhotoViewer from './PhotoViewer';
import ReportDialog from './ReportDialog';
import { Avatar, Modal, RetryImage, UserLink } from './ui';

const PRIVACY_ICON = { PUBLIC: Globe2, FRIENDS: Users, PRIVATE: Lock };

function MediaGrid({ media, onOpenImage }) {
  if (!media?.length) return null;
  const shown = media.slice(0, 4);
  return (
    <div className={clsx('grid gap-0.5 bg-line', shown.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
      {shown.map((m, i) => (
        <div
          key={m.id}
          className={clsx(
            'relative bg-ink-50',
            shown.length === 3 && i === 0 && 'row-span-2',
            shown.length > 1 && 'aspect-square',
          )}
        >
          {m.media_type === 'VIDEO' ? (
            <video
              src={m.file_url}
              controls
              preload="metadata"
              className="h-full max-h-[560px] w-full bg-black object-contain"
            />
          ) : (
            <button
              type="button"
              className="block h-full w-full cursor-zoom-in"
              onClick={() => onOpenImage(m.id)}
              aria-label="Xem ảnh"
            >
              <RetryImage
                src={m.file_url}
                className={clsx('w-full object-cover', shown.length > 1 ? 'h-full' : 'max-h-[560px]')}
              />
            </button>
          )}
          {i === 3 && media.length > 4 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink-900/55 text-2xl font-bold text-white">
              +{media.length - 4}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Menu({ post, onEdit, onReport, onDelete, onPin }) {
  const [open, setOpen] = useState(false);
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper';
  return (
    <div className="relative">
      <button
        className="rounded-full p-1.5 hover:bg-paper"
        onClick={() => setOpen(!open)}
        aria-label="Tùy chọn bài viết"
      >
        <MoreHorizontal className="h-5 w-5 text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
            {post.can_edit && (
              <>
                <button className={item} onClick={() => (setOpen(false), onEdit())}>
                  <Pencil className="h-4 w-4" /> Chỉnh sửa
                </button>
                {!post.group && (
                  <button className={item} onClick={() => (setOpen(false), onPin())}>
                    <Pin className="h-4 w-4" /> {post.is_pinned ? 'Bỏ ghim' : 'Ghim lên trang cá nhân'}
                  </button>
                )}
              </>
            )}
            {post.can_delete && (
              <button className={clsx(item, 'text-danger')} onClick={() => (setOpen(false), onDelete())}>
                <Trash2 className="h-4 w-4" /> Xóa bài viết
              </button>
            )}
            {!post.can_edit && (
              <button className={item} onClick={() => (setOpen(false), onReport())}>
                <Flag className="h-4 w-4" /> Báo cáo bài viết
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function PostCard({ post: initial, queryKeys = [['feed']] }) {
  const qc = useQueryClient();
  const [post, setPost] = useState(initial);
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial.content);
  const [sharing, setSharing] = useState(false);
  const [shareText, setShareText] = useState('');
  const [report, setReport] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(null);
  useEffect(() => setPost(initial), [initial]);
  const refresh = () => queryKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
  const onError = (e) => toast.error(errorMessage(e));

  const like = useMutation({
    mutationFn: () => postApi.like(post.id),
    onMutate: () =>
      setPost((p) => ({ ...p, is_liked: !p.is_liked, likes_count: p.likes_count + (p.is_liked ? -1 : 1) })),
    onSuccess: (d) => setPost((p) => ({ ...p, ...d })),
    onError: (e) => {
      setPost(initial);
      onError(e);
    },
  });
  const update = useMutation({
    mutationFn: () => postApi.update(post.id, { content: draft }),
    onSuccess: (p) => {
      setPost(p);
      setEditing(false);
      toast.success('Đã cập nhật bài viết');
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => postApi.remove(post.id),
    onSuccess: () => {
      toast.success('Đã xóa bài viết');
      setPost((p) => ({ ...p, _deleted: true }));
      refresh();
    },
    onError,
  });
  const pin = useMutation({
    mutationFn: () => postApi.pin(post.id),
    onSuccess: (d) => {
      setPost((p) => ({ ...p, ...d }));
      refresh();
    },
    onError,
  });
  const share = useMutation({
    mutationFn: (text) => postApi.share(post.id, text),
    onSuccess: () => {
      toast.success('Đã chia sẻ lên trang cá nhân');
      setSharing(false);
      setShareText('');
      setPost((p) => ({ ...p, shares_count: p.shares_count + 1 }));
    },
    onError,
  });

  if (post._deleted) return null;
  const PrivacyIcon = PRIVACY_ICON[post.privacy] || Globe2;
  const images = (post.media || []).filter((m) => m.media_type !== 'VIDEO');
  const openImage = (id) => setViewerIndex(Math.max(0, images.findIndex((m) => m.id === id)));

  return (
    <article className="card overflow-hidden">
      {post.is_flagged && (
        <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-xs text-ink-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Bài viết đang bị ẩn với người khác do chứa từ ngữ không phù hợp, chờ quản trị viên xem xét.
        </div>
      )}
      <header className="flex items-start gap-3 px-4 pt-4">
        <Link to={`/u/${post.author?.id}`}>
          <Avatar user={post.author} showOnline />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-snug">
            <UserLink user={post.author} />
            {post.group && (
              <>
                <span className="text-muted"> trong </span>
                <Link to={`/groups/${post.group.id}`} className="font-semibold hover:underline">
                  {post.group.name}
                </Link>
              </>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <Link to={`/posts/${post.id}`} className="hover:underline">
              {timeAgo(post.created_at)}
            </Link>
            {post.is_edited && <span>(đã sửa)</span>}
            {!post.group && <PrivacyIcon className="h-3.5 w-3.5" aria-label={PRIVACY_LABEL[post.privacy]} />}
            {post.is_pinned && <Pin className="h-3.5 w-3.5 text-amber-600" aria-label="Đã ghim" />}
          </div>
        </div>
        <Menu
          post={post}
          onEdit={() => setEditing(true)}
          onPin={() => pin.mutate()}
          onReport={() => setReport({ type: 'POST', id: post.id })}
          onDelete={() => window.confirm('Xóa bài viết này?') && remove.mutate()}
        />
      </header>

      <div className="px-4 py-3">
        {editing ? (
          <div className="space-y-2">
            <textarea className="input min-h-24" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditing(false)}>
                Hủy
              </button>
              <button className="btn-primary" onClick={() => update.mutate()} disabled={update.isPending}>
                Lưu thay đổi
              </button>
            </div>
          </div>
        ) : (
          post.content && (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{post.content}</p>
          )
        )}
      </div>

      <MediaGrid media={post.media} onOpenImage={openImage} />

      <div className="flex items-center justify-between px-4 py-2 text-xs text-muted">
        <span>{post.likes_count > 0 && `${compactNumber(post.likes_count)} lượt thích`}</span>
        <span className="flex gap-3">
          {post.comments_count > 0 && (
            <button className="hover:underline" onClick={() => setShowComments(true)}>
              {compactNumber(post.comments_count)} bình luận
            </button>
          )}
          {post.shares_count > 0 && <span>{compactNumber(post.shares_count)} chia sẻ</span>}
        </span>
      </div>

      <div className="mx-4 grid grid-cols-3 border-t border-line py-1">
        <button
          className={clsx(
            'btn rounded-lg font-medium hover:bg-paper',
            post.is_liked ? 'text-danger' : 'text-muted',
          )}
          onClick={() => like.mutate()}
          aria-pressed={post.is_liked}
        >
          <Heart className={clsx('h-[18px] w-[18px]', post.is_liked && 'fill-current')} /> Thích
        </button>
        <button
          className="btn rounded-lg font-medium text-muted hover:bg-paper"
          onClick={() => setShowComments(!showComments)}
        >
          <MessageCircle className="h-[18px] w-[18px]" /> Bình luận
        </button>
        <button
          className="btn rounded-lg font-medium text-muted hover:bg-paper disabled:opacity-40"
          onClick={() => setSharing(true)}
          disabled={post.privacy !== 'PUBLIC' || !!post.group}
          title={post.privacy !== 'PUBLIC' || post.group ? 'Chỉ chia sẻ được bài viết công khai' : undefined}
        >
          <Share2 className="h-[18px] w-[18px]" /> Chia sẻ
        </button>
      </div>

      {showComments && (
        <CommentThread
          postId={post.id}
          onCountChange={(d) => setPost((p) => ({ ...p, comments_count: p.comments_count + d }))}
        />
      )}

      <Modal open={sharing} onClose={() => setSharing(false)} title="Chia sẻ bài viết">
        <textarea
          className="input min-h-24"
          placeholder="Nói gì đó về bài viết này..."
          value={shareText}
          onChange={(e) => setShareText(e.target.value)}
        />
        <button className="btn-primary mt-3 w-full" onClick={() => share.mutate(shareText)} disabled={share.isPending}>
          Chia sẻ lên trang cá nhân
        </button>
      </Modal>
      {viewerIndex !== null && (
        <PhotoViewer
          post={post}
          images={images}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onLike={() => like.mutate()}
          canShare={post.privacy === 'PUBLIC' && !post.group}
          onShare={(text, done) => share.mutate(text, { onSuccess: done })}
          sharePending={share.isPending}
          onCountChange={(d) => setPost((p) => ({ ...p, comments_count: p.comments_count + d }))}
        />
      )}
      {report && <ReportDialog target={report} onClose={() => setReport(null)} />}
    </article>
  );
}