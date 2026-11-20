import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Globe2, Heart, Lock, MessageCircle, Share2, Users, X } from 'lucide-react';
import clsx from 'clsx';
import { PRIVACY_LABEL, compactNumber, timeAgo } from '../lib/format';
import CommentThread from './CommentThread';
import { Avatar, Modal, RetryImage, UserLink } from './ui';

const PRIVACY_ICON = { PUBLIC: Globe2, FRIENDS: Users, PRIVATE: Lock };

/**
 * Trình xem ảnh toàn màn hình kiểu Facebook:
 * - Bên trái: ảnh phóng to (mũi tên / phím ← → để chuyển ảnh, Esc để đóng).
 * - Bên phải: tác giả, nội dung bài viết, lượt thích, bình luận.
 * Trên màn hình nhỏ, panel thông tin nằm bên dưới ảnh.
 */
export default function PhotoViewer({
  post,
  images,
  startIndex = 0,
  onClose,
  onLike,
  onCountChange,
  canShare = false,
  onShare,
  sharePending = false,
}) {
  const [index, setIndex] = useState(startIndex);
  const [sharing, setSharing] = useState(false);
  const [shareText, setShareText] = useState('');
  const panelRef = useRef(null);
  const total = images.length;
  const current = images[index];
  const PrivacyIcon = PRIVACY_ICON[post.privacy] || Globe2;

  const prev = useCallback(() => setIndex((i) => (i - 1 + total) % total), [total]);
  const next = useCallback(() => setIndex((i) => (i + 1) % total), [total]);

  useEffect(() => {
    const onKey = (e) => {
      if (sharing) return undefined; // hộp thoại chia sẻ tự xử lý Esc
      if (e.key === 'Escape') return onClose();
      // Không chuyển ảnh khi đang gõ bình luận.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return undefined;
      if (e.key === 'ArrowLeft' && total > 1) prev();
      if (e.key === 'ArrowRight' && total > 1) next();
      return undefined;
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, prev, next, total, sharing]);

  if (!current) return null;

  const focusComment = () => panelRef.current?.querySelector('input')?.focus();

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Xem ảnh"
      className="fixed inset-0 z-50 flex flex-col bg-black/95 lg:flex-row"
    >
      {/* Khu vực ảnh */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={onClose}>
        <button
          type="button"
          onClick={(e) => (e.stopPropagation(), onClose())}
          className="absolute left-3 top-3 z-10 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
          aria-label="Đóng"
        >
          <X className="h-6 w-6" />
        </button>

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), prev())}
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
              aria-label="Ảnh trước"
            >
              <ChevronLeft className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), next())}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
              aria-label="Ảnh sau"
            >
              <ChevronRight className="h-7 w-7" />
            </button>
            <span className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              {index + 1} / {total}
            </span>
          </>
        )}

        <RetryImage
          key={current.id}
          src={current.file_url}
          alt={post.content?.slice(0, 80) || 'Ảnh bài viết'}
          loading="eager"
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full select-none object-contain"
        />
      </div>

      {/* Panel thông tin bên phải */}
      <aside
        ref={panelRef}
        className="flex max-h-[55vh] w-full shrink-0 flex-col overflow-y-auto bg-white lg:max-h-none lg:w-[380px]"
      >
        <header className="flex items-start gap-3 px-4 pt-4">
          <Link to={`/u/${post.author?.id}`} onClick={onClose}>
            <Avatar user={post.author} showOnline />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] leading-snug">
              <UserLink user={post.author} />
              {post.group && (
                <>
                  <span className="text-muted"> trong </span>
                  <Link to={`/groups/${post.group.id}`} onClick={onClose} className="font-semibold hover:underline">
                    {post.group.name}
                  </Link>
                </>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <span>{timeAgo(post.created_at)}</span>
              {post.is_edited && <span>(đã sửa)</span>}
              {!post.group && <PrivacyIcon className="h-3.5 w-3.5" aria-label={PRIVACY_LABEL[post.privacy]} />}
            </div>
          </div>
        </header>

        {post.content && (
          <p className="whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-relaxed">{post.content}</p>
        )}

        <div className="flex items-center justify-between px-4 py-2 text-xs text-muted">
          <span>{post.likes_count > 0 && `${compactNumber(post.likes_count)} lượt thích`}</span>
          <span>{post.comments_count > 0 && `${compactNumber(post.comments_count)} bình luận`}</span>
        </div>

        <div className="mx-4 grid grid-cols-3 border-y border-line py-1">
          <button
            type="button"
            className={clsx('btn rounded-lg font-medium hover:bg-paper', post.is_liked ? 'text-danger' : 'text-muted')}
            onClick={onLike}
            aria-pressed={post.is_liked}
          >
            <Heart className={clsx('h-[18px] w-[18px]', post.is_liked && 'fill-current')} /> Thích
          </button>
          <button
            type="button"
            className="btn rounded-lg font-medium text-muted hover:bg-paper"
            onClick={focusComment}
          >
            <MessageCircle className="h-[18px] w-[18px]" /> Bình luận
          </button>
          <button
            type="button"
            className="btn rounded-lg font-medium text-muted hover:bg-paper disabled:opacity-40"
            onClick={() => setSharing(true)}
            disabled={!canShare}
            title={canShare ? undefined : 'Chỉ chia sẻ được bài viết công khai'}
          >
            <Share2 className="h-[18px] w-[18px]" /> Chia sẻ
          </button>
        </div>

        <CommentThread postId={post.id} onCountChange={onCountChange} />
      </aside>

      <Modal open={sharing} onClose={() => setSharing(false)} title="Chia sẻ bài viết">
        <textarea
          className="input min-h-24"
          placeholder="Nói gì đó về bài viết này..."
          value={shareText}
          onChange={(e) => setShareText(e.target.value)}
        />
        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={sharePending}
          onClick={() =>
            onShare?.(shareText, () => {
              setSharing(false);
              setShareText('');
            })
          }
        >
          Chia sẻ lên trang cá nhân
        </button>
      </Modal>
    </div>,
    document.body,
  );
}