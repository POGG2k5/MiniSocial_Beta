import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { userApi } from '../api/endpoints';
import FriendButton from '../components/FriendButton';
import { Avatar, EmptyState, PageLoader, Tabs, UserLink } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { mutualLabel, timeAgo } from '../lib/format';
import { toast } from '../store/toast';

function Row({ user, children, sub }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar user={user} size={48} showOnline />
      <div className="min-w-0 flex-1">
        <UserLink user={user} className="block truncate" />
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      {children}
    </li>
  );
}

/** UC-09, UC-10: bạn bè, lời mời đã nhận / đã gửi, gợi ý, danh sách chặn. */
export default function FriendsPage() {
  const [tab, setTab] = useState('received');
  const qc = useQueryClient();
  const received = useQuery({
    queryKey: ['friend-requests', 'received'],
    queryFn: () => userApi.requests('received'),
  });
  const sent = useQuery({
    queryKey: ['friend-requests', 'sent'],
    queryFn: () => userApi.requests('sent'),
    enabled: tab === 'sent',
  });
  const friends = useQuery({
    queryKey: ['friends', 'me'],
    queryFn: () => userApi.friends(),
    enabled: tab === 'friends',
  });
  const suggest = useQuery({
    queryKey: ['suggestions'],
    queryFn: userApi.suggestions,
    enabled: tab === 'suggest',
  });
  const blocks = useQuery({ queryKey: ['blocks'], queryFn: userApi.blocks, enabled: tab === 'blocks' });
  const unblock = useMutation({
    mutationFn: userApi.unblock,
    onSuccess: () => {
      toast.success('Đã bỏ chặn');
      qc.invalidateQueries({ queryKey: ['blocks'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const current = { received, sent, friends, suggest, blocks }[tab];

  return (
    <div className="mx-auto max-w-[720px]">
      <h1 className="mb-4 text-xl font-bold">Bạn bè</h1>
      <div className="card overflow-hidden">
        <div className="px-2">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'received', label: 'Lời mời', count: received.data?.length },
              { value: 'friends', label: 'Tất cả bạn bè' },
              { value: 'suggest', label: 'Gợi ý' },
              { value: 'sent', label: 'Đã gửi' },
              { value: 'blocks', label: 'Đã chặn' },
            ]}
          />
        </div>
        {current.isLoading && <PageLoader />}
        <ul className="divide-y divide-line">
          {tab === 'received' &&
            (received.data || []).map((r) => (
              <Row key={r.id} user={r.sender} sub={`Gửi ${timeAgo(r.created_at)}`}>
                <FriendButton
                  userId={r.sender.id}
                  relationship={{ status: 'PENDING_RECEIVED', friendship_id: r.id }}
                />
              </Row>
            ))}
          {tab === 'sent' &&
            (sent.data || []).map((r) => (
              <Row key={r.id} user={r.receiver} sub={`Đã gửi ${timeAgo(r.created_at)}`}>
                <FriendButton
                  userId={r.receiver.id}
                  relationship={{ status: 'PENDING_SENT', friendship_id: r.id }}
                />
              </Row>
            ))}
          {tab === 'friends' &&
            (friends.data || []).map((u) => (
              <Row key={u.id} user={u}>
                <FriendButton userId={u.id} relationship={{ status: 'FRIENDS' }} />
              </Row>
            ))}
          {tab === 'suggest' &&
            (suggest.data || []).map((u) => (
              <Row key={u.id} user={u} sub={mutualLabel(u.mutual_friends_count)}>
                <FriendButton
                  userId={u.id}
                  relationship={{ status: 'NONE' }}
                  onChanged={() => suggest.refetch()}
                />
              </Row>
            ))}
          {tab === 'blocks' &&
            (blocks.data || []).map((u) => (
              <Row key={u.id} user={u}>
                <button className="btn-ghost" onClick={() => unblock.mutate(u.id)}>
                  Bỏ chặn
                </button>
              </Row>
            ))}
        </ul>
        {current.isSuccess && current.data?.length === 0 && (
          <div className="p-4">
            <EmptyState icon={Users} title="Danh sách trống" />
          </div>
        )}
      </div>
    </div>
  );
}
