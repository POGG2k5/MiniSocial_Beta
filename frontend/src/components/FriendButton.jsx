import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UserCheck, Clock, UserX } from 'lucide-react';
import { userApi } from '../api/endpoints';
import { errorMessage } from '../lib/errors';
import { toast } from '../store/toast';
import { confirmDialog } from './ConfirmDialog';

/** Nút thể hiện máy trạng thái kết bạn: NONE -> PENDING -> FRIENDS. */
export default function FriendButton({ userId, relationship, onChanged }) {
  const qc = useQueryClient();
  const status = relationship?.status || 'NONE';
  const fid = relationship?.friendship_id;
  const done = (msg) => {
    if (msg) toast.success(msg);
    qc.invalidateQueries({ queryKey: ['profile', userId] });
    qc.invalidateQueries({ queryKey: ['friend-requests'] });
    qc.invalidateQueries({ queryKey: ['friends'] });
    qc.invalidateQueries({ queryKey: ['search'] });
    onChanged?.();
  };
  const m = useMutation({
    mutationFn: async (action) => {
      if (action === 'send') return userApi.sendRequest(userId);
      if (action === 'accept') return userApi.accept(fid);
      if (action === 'decline') return userApi.decline(fid);
      if (action === 'cancel') return userApi.cancel(fid);
      if (action === 'unfriend') return userApi.unfriend(userId);
      if (action === 'unblock') return userApi.unblock(userId);
      return null;
    },
    onSuccess: () => done(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const busy = m.isPending;

  if (status === 'SELF' || status === 'BLOCKED_BY') return null;
  if (status === 'BLOCKED')
    return (
      <button className="btn-ghost" disabled={busy} onClick={() => m.mutate('unblock')}>
        Bỏ chặn
      </button>
    );
  if (status === 'FRIENDS')
    return (
      <button
        className="btn-ghost"
        disabled={busy}
        onClick={async () => {
          const ok = await confirmDialog({
            title: 'Hủy kết bạn?',
            message: 'Hai bạn sẽ không còn thấy bài viết chỉ dành cho bạn bè của nhau.',
            confirmText: 'Hủy kết bạn',
            danger: true,
          });
          if (ok) m.mutate('unfriend');
        }}
      >
        <UserCheck className="h-4 w-4" /> Bạn bè
      </button>
    );
  if (status === 'PENDING_SENT')
    return (
      <button className="btn-ghost" disabled={busy} onClick={() => m.mutate('cancel')}>
        <Clock className="h-4 w-4" /> Thu hồi lời mời
      </button>
    );
  if (status === 'PENDING_RECEIVED')
    return (
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => m.mutate('accept')}>
          <UserCheck className="h-4 w-4" /> Chấp nhận
        </button>
        <button className="btn-ghost" disabled={busy} onClick={() => m.mutate('decline')}>
          <UserX className="h-4 w-4" /> Từ chối
        </button>
      </div>
    );
  return (
    <button className="btn-primary" disabled={busy} onClick={() => m.mutate('send')}>
      <UserPlus className="h-4 w-4" /> Kết bạn
    </button>
  );
}
