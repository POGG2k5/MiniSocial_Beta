import { create } from 'zustand';
import { Modal } from './ui';

/**
 * Hộp thoại xác nhận trong giao diện, thay cho window.confirm của trình duyệt (FIX_UI_01).
 * Dùng: if (await confirmDialog({ title, message, confirmText, danger: true })) { ... }
 */
const useConfirmStore = create((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

export function confirmDialog(options) {
  return new Promise((resolve) => {
    const pending = useConfirmStore.getState().request;
    if (pending) pending.resolve(false);
    useConfirmStore.getState().open({ ...options, resolve });
  });
}

/** Đặt một lần ở gốc ứng dụng (App.jsx). */
export function ConfirmHost() {
  const { request, close } = useConfirmStore();
  if (!request) return null;
  const done = (value) => {
    request.resolve(value);
    close();
  };
  return (
    <Modal open onClose={() => done(false)} title={request.title || 'Xác nhận'}>
      {request.message && <p className="text-sm text-muted">{request.message}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={() => done(false)}>
          {request.cancelText || 'Hủy'}
        </button>
        <button
          autoFocus
          className={request.danger ? 'btn bg-danger text-white hover:bg-danger/90' : 'btn-primary'}
          onClick={() => done(true)}
        >
          {request.confirmText || 'Đồng ý'}
        </button>
      </div>
    </Modal>
  );
}
