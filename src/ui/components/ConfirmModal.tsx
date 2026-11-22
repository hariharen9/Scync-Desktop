import { useUiStore } from '@/stores/uiStore.js';
import { useEscape } from './primitives.js';

export default function ConfirmModal() {
  const confirm = useUiStore((s) => s.confirm);
  const dismiss = useUiStore((s) => s.dismissConfirm);
  const resolve = useUiStore((s) => s.resolveConfirm);
  useEscape(Boolean(confirm), dismiss);

  if (!confirm) return null;

  return (
    <div className="modal-overlay !z-[80]" onClick={dismiss}>
      <div className="modal-panel card w-full max-w-sm p-5 anim-scale-in" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <h2 className="font-display font-bold text-[15px] tracking-tight mb-1.5">{confirm.title}</h2>
        <p className="text-muted text-[13px] leading-relaxed mb-5">{confirm.message}</p>
        <div className="flex gap-2 justify-end">
          <button className="btn-ghost" onClick={dismiss} autoFocus>Cancel</button>
          <button
            className={confirm.danger ? 'btn-danger' : 'btn-primary'}
            onClick={resolve}
          >
            {confirm.confirmText ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
