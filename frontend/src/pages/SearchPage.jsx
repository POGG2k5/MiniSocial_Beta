import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { userApi } from '../api/endpoints';
import FriendButton from '../components/FriendButton';
import { Avatar, EmptyState, PageLoader, UserLink } from '../components/ui';
import { useDebounced } from '../hooks/useDebounced';
import { mutualLabel } from '../lib/format';

/** UC-08: tìm kiếm người dùng tiếng Việt có dấu / không dấu (MySQL FULLTEXT ngram). */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const term = useDebounced(q.trim(), 350);
  const results = useQuery({
    queryKey: ['search', term],
    queryFn: () => userApi.search(term),
    enabled: term.length >= 2,
  });
  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          className="input py-3 pl-10 text-base"
          placeholder="Nhập tên, ví dụ: nguyen van duc"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
          }}
          aria-label="Tìm người dùng"
        />
      </div>
      {results.isFetching && <PageLoader />}
      {term.length >= 2 && results.isSuccess && results.data.length === 0 && (
        <EmptyState icon={Search} title={`Không tìm thấy ai tên "${term}"`}>
          Thử viết không dấu hoặc chỉ nhập tên riêng.
        </EmptyState>
      )}
      {results.data?.length > 0 && (
        <ul className="card divide-y divide-line">
          {results.data.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar user={u} size={48} showOnline />
              <div className="min-w-0 flex-1">
                <UserLink user={u} className="block truncate" />
                {u.mutual_friends_count > 0 && (
                  <p className="text-xs text-muted">{mutualLabel(u.mutual_friends_count)}</p>
                )}
              </div>
              <FriendButton userId={u.id} relationship={u.relationship} onChanged={() => results.refetch()} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
