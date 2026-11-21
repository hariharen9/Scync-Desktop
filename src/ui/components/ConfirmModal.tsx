import { useUiStore } from '@/stores/uiStore.js';

export default function ConfirmModal() {
  const confirm = useUiStore((s) => s.confirm);

  if (!confirm) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={() => useUiStore.getState().dismissConfirm()}>
      <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-sm mb-1">{confirm.title}</h2>
        <p className="text-muted text-[13px] mb-4">{confirm.message}</p>
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost" onClick={() => useUiStore.getState().dismissConfirm()}>Cancel</button>
          <button
            className={confirm.danger ? 'px-3.5 py-1.5 rounded-lg text-[13px] font-semibold bg-red-600 hover:bg-red-500 text-white' : 'btn-primary'}
            onClick={() => useUiStore.getState().resolveConfirm()}
          >
            {confirm.confirmText ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
