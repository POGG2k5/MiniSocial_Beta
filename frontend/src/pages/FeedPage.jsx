import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Newspaper, UserPlus } from 'lucide-react';
import { postApi, userApi } from '../api/endpoints';
import FriendButton from '../components/FriendButton';
import PostCard from '../components/PostCard';
import PostComposer from '../components/PostComposer';
import { Avatar, EmptyState, LoadMore, PageLoader, UserLink } from '../components/ui';
import { useCursorList } from '../hooks/useCursorList';
import { mutualLabel } from '../lib/format';

function Suggestions() {
  const q = useQuery({ queryKey: ['suggestions'], queryFn: userApi.suggestions });
  if (!q.data?.length) return null;
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">Gợi ý kết bạn</h2>
      <ul className="space-y-3">
        {q.data.slice(0, 5).map((u) => (
          <li key={u.id} className="flex items-center gap-3">
            <Avatar user={u} />
            <div className="min-w-0 flex-1">
              <UserLink user={u} className="block truncate text-sm" />
              {u.mutual_friends_count > 0 && (
                <p className="text-xs text-muted">{mutualLabel(u.mutual_friends_count)}</p>
              )}
            </div>
            <FriendButton userId={u.id} relationship={{ status: 'NONE' }} onChanged={() => q.refetch()} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** UC-13: bảng tin bạn bè, phân trang con trỏ. */
export default function FeedPage() {
  const feed = useCursorList(['feed'], postApi.feed);
  const hasFriends = feed.firstPage?.has_friends;

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <PostComposer />
      {feed.isLoading && <PageLoader />}
      {feed.firstPage && hasFriends === false && (
        <EmptyState
          icon={UserPlus}
          title="Bảng tin còn trống"
          action={
            <Link to="/friends" className="btn-primary">
              Tìm bạn bè
            </Link>
          }
        >
          Kết bạn để xem bài viết mới nhất của mọi người tại đây.
        </EmptyState>
      )}
      {feed.firstPage && hasFriends === false && <Suggestions />}
      {feed.items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {feed.firstPage && hasFriends && feed.items.length === 0 && (
        <EmptyState icon={Newspaper} title="Chưa có bài viết mới">
          Bạn bè của bạn chưa đăng gì. Hãy là người mở đầu!
        </EmptyState>
      )}
      <LoadMore query={feed} />
    </div>
  );
}
